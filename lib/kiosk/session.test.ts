import { describe, expect, it } from "vitest";
import { openKioskToken, sealKioskToken } from "./session";

const KEY = "test-secret";

describe("kiosk session token", () => {
  it("round-trips a valid payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = sealKioskToken({ employeeId: "emp-1", exp }, KEY);
    expect(openKioskToken(token, KEY)).toEqual({ employeeId: "emp-1", exp });
  });

  it("rejects an expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = sealKioskToken({ employeeId: "emp-1", exp }, KEY);
    expect(openKioskToken(token, KEY)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = sealKioskToken({ employeeId: "emp-1", exp }, KEY);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ employeeId: "someone-else", exp }),
    ).toString("base64url");
    expect(openKioskToken(`${forged}.${mac}`, KEY)).toBeNull();
    expect(openKioskToken(`${body}.AAAA`, KEY)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = sealKioskToken({ employeeId: "emp-1", exp }, "other-key");
    expect(openKioskToken(token, KEY)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(openKioskToken("", KEY)).toBeNull();
    expect(openKioskToken(null, KEY)).toBeNull();
    expect(openKioskToken("no-dot-here", KEY)).toBeNull();
  });
});
