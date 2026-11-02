import type { Money } from "@fpving/plugin-sdk";
import { TREND_DAYS } from "@fpving/core";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Sparkline } from "../../src/ui/sparkline.tsx";
import { styleOf } from "../support/style.ts";
import "../../src/styles.css";

const PRICE: Money = { amountMinor: 4200, currency: "EUR" };

describe("Sparkline", () => {
  it("strokes the trend in the first series colour with round joins", async () => {
    const screen = await render(<Sparkline trend={Array.from({ length: TREND_DAYS }, () => PRICE)} />);
    await expect.element(screen.getByRole("application")).toBeVisible();
    const curve = screen.container.querySelector(".recharts-line-curve");
    expect(curve?.getAttribute("stroke")).toBe("var(--color-series-1)");
    expect(curve?.getAttribute("stroke-linejoin")).toBe("round");
  });

  it("shows the day's price in the readout face on the raised tooltip", async () => {
    const screen = await render(<Sparkline trend={Array.from({ length: TREND_DAYS }, () => PRICE)} />);
    await userEvent.hover(screen.getByRole("application"));
    const amount = screen.getByText("€42.00", { exact: true });
    await expect.element(amount).toBeVisible();
    expect(styleOf(amount).fontFamily).toContain("Martian Mono");
  });

  it("says when no day has a price, in small muted text", async () => {
    const screen = await render(<Sparkline trend={Array.from({ length: TREND_DAYS }, () => null)} />);
    const note = screen.getByText(`No prices in the last ${String(TREND_DAYS)} days`);
    expect(styleOf(note).fontSize).toBe("12px");
  });
});
