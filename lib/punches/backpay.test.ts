import { describe, expect, it } from "vitest";
import { backPayNote, backPayWorkDate, isBackPayPunch } from "./backpay";

describe("backpay note tag", () => {
  it("round-trips the worked date through the note", () => {
    const note = backPayNote("2026-07-18", "From request abc.");
    expect(isBackPayPunch({ notes: note })).toBe(true);
    expect(backPayWorkDate(note)).toBe("2026-07-18");
    expect(note).toContain("From request abc.");
  });

  it("ignores ordinary punch notes", () => {
    expect(isBackPayPunch({ notes: "dev:CS102 scrape:07/20/2026" })).toBe(false);
    expect(isBackPayPunch({ notes: null })).toBe(false);
    expect(isBackPayPunch({})).toBe(false);
    expect(backPayWorkDate("ambiguous:single")).toBeNull();
  });

  it("detects the tag anywhere in a longer note", () => {
    const note = `edited by admin\n${backPayNote("2026-07-11", "late report")}`;
    expect(backPayWorkDate(note)).toBe("2026-07-11");
  });
});
