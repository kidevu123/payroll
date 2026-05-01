import { describe, it, expect } from "vitest";
import { toCsv } from "./csv-export";

describe("toCsv", () => {
  it("renders header + rows", () => {
    const out = toCsv(
      [
        { name: "A", n: 1 },
        { name: "B", n: 2 },
      ],
      ["name", "n"],
    );
    expect(out).toBe("name,n\r\nA,1\r\nB,2\r\n");
  });

  it("quotes fields with comma, quote, or newline", () => {
    const out = toCsv(
      [
        { s: "hello, world" },
        { s: 'a "quoted" word' },
        { s: "line1\nline2" },
      ],
      ["s"],
    );
    expect(out).toBe(
      's\r\n"hello, world"\r\n"a ""quoted"" word"\r\n"line1\nline2"\r\n',
    );
  });

  it("renders booleans, dates, and nulls", () => {
    const d = new Date("2026-04-19T12:00:00Z");
    const out = toCsv(
      [{ a: true, b: false, c: d, d: null, e: undefined }],
      ["a", "b", "c", "d", "e"],
    );
    expect(out).toBe(
      "a,b,c,d,e\r\ntrue,false,2026-04-19T12:00:00.000Z,,\r\n",
    );
  });

  it("handles empty row list", () => {
    expect(toCsv([], ["a", "b"])).toBe("a,b\r\n");
  });
});
