import { describe, expect, it } from "vitest";
import { isEnvelope } from "./envelope";

describe("isEnvelope", () => {
  it("accepts an object carrying ciphertext and iv", () => {
    expect(isEnvelope({ ciphertext: "a", iv: "b" })).toBe(true);
    expect(isEnvelope({ ciphertext: "a", iv: "b", tag: "c" })).toBe(true);
  });
  it("rejects everything else", () => {
    for (const v of [null, undefined, "x", 1, [], {}, { ciphertext: "a" }, { iv: "b" }]) expect(isEnvelope(v)).toBe(false);
  });
});
