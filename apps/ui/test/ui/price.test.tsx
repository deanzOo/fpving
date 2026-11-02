import type { Money } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Price } from "../../src/ui/price.tsx";
import { rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const euros = (amountMinor: number): Money => ({ amountMinor, currency: "EUR" });
const NOW = 18_490;
const BEFORE = 20_000;
const RISE = 4335;
const RISE_BEFORE = 4215;

describe("Price", () => {
  it("shows the formatted amount in the readout face", async () => {
    const screen = await render(<Price money={euros(NOW)} />);
    const price = screen.getByText("€184.90");
    expect(styleOf(price).fontFamily).toContain("Martian Mono");
    expect(styleOf(price).fontSize).toBe("13px");
  });

  it("shows a headline price in the large readout", async () => {
    const screen = await render(<Price money={euros(NOW)} large />);
    expect(styleOf(screen.getByText("€184.90")).fontSize).toBe("20px");
  });

  it("says a drop with ▼, the amount and the percentage in the good colour", async () => {
    const screen = await render(<Price money={euros(NOW)} previous={euros(BEFORE)} />);
    const delta = screen.getByText("€15.10 · 7.6%", { exact: false });
    await expect.element(delta).toHaveTextContent("▼ down €15.10 · 7.6%");
    expect(styleOf(delta).color).toBe(rgb(token("--color-good")));
  });

  it("says a rise with ▲ in muted ink, because a rise is news, not a fault", async () => {
    const screen = await render(<Price money={euros(RISE)} previous={euros(RISE_BEFORE)} />);
    const delta = screen.getByText("€1.20 · 2.8%", { exact: false });
    await expect.element(delta).toHaveTextContent("▲ up €1.20 · 2.8%");
    expect(styleOf(delta).color).toBe(rgb(token("--color-ink-muted")));
  });

  it.each([
    ["the same amount", euros(NOW)],
    ["another currency", { amountMinor: BEFORE, currency: "USD" } as const],
  ])("shows no change from %s", async (_case, previous) => {
    const screen = await render(<Price money={euros(NOW)} previous={previous} />);
    await expect.element(screen.getByText("€184.90")).toBeVisible();
    expect(screen.container.textContent).toBe("€184.90");
  });

  it("leaves the percentage out after a free price", async () => {
    const screen = await render(<Price money={euros(NOW)} previous={euros(0)} />);
    await expect.element(screen.getByText("up €184.90", { exact: false })).toHaveTextContent("▲ up €184.90");
  });

  it("says a missing price as a muted sentence in the sans face", async () => {
    const screen = await render(<Price money={null} missing="Not priced" />);
    const none = screen.getByText("Not priced");
    expect(styleOf(none).fontFamily).toContain("IBM Plex Sans");
    expect(styleOf(none).color).toBe(rgb(token("--color-ink-muted")));
  });

  it("says No price yet by default", async () => {
    const screen = await render(<Price money={null} />);
    await expect.element(screen.getByText("No price yet")).toBeVisible();
  });
});
