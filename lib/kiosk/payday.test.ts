import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPaydayFailures,
  generatePaydayCode,
  openPaydayToken,
  paydayLockedUntil,
  recordPaydayFailure,
  sealPaydayToken,
} from "./payday";
import { sealKioskToken } from "./session";

const KEY = "test-secret";

describe("generatePaydayCode", () => {
  it("is six zero-padded digits", () => {
    expect(generatePaydayCode()).toMatch(/^\d{6}$/);
    expect(generatePaydayCode(() => 42)).toBe("000042");
    expect(generatePaydayCode(() => 999_999)).toBe("999999");
  });
});

describe("payday wrong-code throttle", () => {
  beforeEach(() => clearPaydayFailures());

  it("locks for a minute after five failures", () => {
    for (let i = 0; i < 4; i += 1) recordPaydayFailure(1_000);
    expect(paydayLockedUntil(1_000)).toBeNull();
    recordPaydayFailure(1_000);
    expect(paydayLockedUntil(1_000)).toBe(61_000);
    expect(paydayLockedUntil(61_000)).toBeNull();
  });
});

describe("payday session token", () => {
  it("round-trips and honors exp", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = sealPaydayToken({ periodId: "p1", exp }, KEY);
    expect(openPaydayToken(token, KEY)).toEqual({ periodId: "p1", exp });
    expect(openPaydayToken(token, KEY, exp)).toBeNull();
  });

  it("never opens a kiosk employee token as a payday token", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const kiosk = sealKioskToken({ employeeId: "e1", exp }, KEY);
    expect(openPaydayToken(kiosk, KEY)).toBeNull();
  });

  it("rejects a payload without a period id", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = sealPaydayToken({ exp } as never, KEY);
    expect(openPaydayToken(token, KEY)).toBeNull();
  });
});
