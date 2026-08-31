import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button geometry", () => {
  it("gives default actions a 44px minimum target", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);

    expect(html).toContain("min-h-11");
  });

  it("keeps icon actions square at 44px", () => {
    const html = renderToStaticMarkup(
      <Button size="icon" aria-label="Open settings">
        <span aria-hidden>+</span>
      </Button>,
    );

    expect(html).toContain("h-11");
    expect(html).toContain("w-11");
  });
});
