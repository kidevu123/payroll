import { beforeEach, describe, expect, it } from "vitest";
import {
  PAYDAY_CODE_TTL_S,
  clearPaydayFailures,
  consumePaydayCode,
  issuePaydayCode,
  openPaydayToken,
  paydayLockedUntil,
  recordPaydayFailure,
  sealPaydayToken,
} from "./payday";
import { sealKioskToken } from "./session";

const KEY = "test-secret";

describe("payday codes", () => {
  it("issues a six-digit code that redeems exactly once", () => {
    const { code } = issuePaydayCode("period-a", 1_000);
    expect(code).toMatch(/^\d{6}$/);
    expect(consumePaydayCode(code, 2_000)).toBe("period-a");
    expect(consumePaydayCode(code, 3_000)).toBeNull();
  });

  it("zero-pads small random values", () => {
    const { code } = issuePaydayCode("period-pad", 1_000, () => 42);
    expect(code).toBe("000042");
    expect(consumePaydayCode(code, 1_500)).toBe("period-pad");
  });

  it("expires after the TTL", () => {
    const { code, expiresAt } = issuePaydayCode("period-b", 1_000);
    expect(expiresAt.getTime()).toBe(1_000 + PAYDAY_CODE_TTL_S * 1000);
    expect(consumePaydayCode(code, 1_000 + PAYDAY_CODE_TTL_S * 1000)).toBeNull();
  });

  it("re-issuing for the same period revokes the older code", () => {
    const first = issuePaydayCode("period-c", 1_000).code;
    const second = issuePaydayCode("period-c", 1_001).code;
    expect(consumePaydayCode(first, 1_002)).toBeNull();
    expect(consumePaydayCode(second, 1_002)).toBe("period-c");
  });

  it("rejects unknown codes", () => {
    expect(consumePaydayCode("999999", 1_000)).toBeNull();
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
