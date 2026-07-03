import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashCard, Eyebrow } from "./dash-primitives";

describe("dashboard geometry primitives", () => {
  it("uses content-safe card padding", () => {
    const html = renderToStaticMarkup(<DashCard>Payroll health</DashCard>);

    expect(html).toContain("p-4");
  });

  it("keeps operational captions at twelve pixels", () => {
    const html = renderToStaticMarkup(<Eyebrow>Total pay period</Eyebrow>);

    expect(html).toContain("text-xs");
    expect(html).not.toContain("text-[10px]");
  });
});
