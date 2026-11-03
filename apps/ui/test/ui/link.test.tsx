import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { LINK } from "../../src/ui/link.ts";
import { rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

describe("Link", () => {
  it("underlines a link in the strong line colour, in the text's own ink", async () => {
    const screen = await render(<a href="/products/p1" className={LINK}>Source One V5</a>);
    const style = styleOf(screen.getByRole("link"));
    expect(style.textDecorationLine).toBe("underline");
    expect(style.textDecorationColor).toBe(rgb(token("--color-line-strong")));
    expect(style.color).toBe(rgb(token("--color-ink")));
  });
});
