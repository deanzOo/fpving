import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Badge, BadgeTone, Count } from "../../src/ui/badge.tsx";
import { EmptyState, EmptyTag } from "../../src/ui/empty-state.tsx";
import { Notice, NoticeTone } from "../../src/ui/notice.tsx";
import { Panel } from "../../src/ui/panel.tsx";
import { hasBrackets, rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

const nth = (container: HTMLElement, index = 0): Element => {
  const element = container.children.item(index);
  if (element === null) {
    throw new Error(`nothing rendered at ${String(index)}`);
  }
  return element;
};

describe("Badge", () => {
  it.each([
    [BadgeTone.Critical, "--color-on-critical", "--color-critical"],
    [BadgeTone.Warning, "--color-warning", "--color-warning-soft"],
    [BadgeTone.Good, "--color-good", "--color-good-soft"],
    [BadgeTone.Info, "--color-info", "--color-info-soft"],
    [BadgeTone.Live, "--color-signal", "--color-signal-soft"],
  ])("shows a %s status as a word, a glyph and its colours", async (tone, ink, fill) => {
    const screen = await render(<Badge tone={tone} glyph="✕">Failed</Badge>);
    const badge = getComputedStyle(nth(screen.container));
    await expect.element(screen.getByText("Failed")).toBeVisible();
    expect(badge.color).toBe(rgb(token(ink)));
    expect(badge.backgroundColor).toBe(rgb(token(fill)));
    expect(badge.textTransform).toBe("uppercase");
    await expect.element(screen.getByText("✕")).toHaveAttribute("aria-hidden", "true");
  });

  it("outlines a neutral status, dashed when it is not judged yet", async () => {
    const screen = await render(
      <>
        <Badge glyph="≠">Different product</Badge>
        <Badge tone={BadgeTone.Pending} glyph="?">Not judged yet</Badge>
      </>,
    );
    const neutral = getComputedStyle(nth(screen.container));
    expect(neutral.backgroundColor).toBe(TRANSPARENT);
    expect(neutral.borderTopColor).toBe(rgb(token("--color-line-strong")));
    expect(getComputedStyle(nth(screen.container, 1)).borderTopStyle).toBe("dashed");
  });

  it("marks a live status with a square dot instead of a glyph", async () => {
    const screen = await render(<Badge tone={BadgeTone.Live}>Loaded</Badge>);
    expect(getComputedStyle(nth(screen.container), "::before").backgroundColor).toBe(rgb(token("--color-signal")));
  });
});

describe("Count", () => {
  it("shows the number to sight only, in the signal colours", async () => {
    const screen = await render(<Count count={3} />);
    const count = screen.getByText("3");
    await expect.element(count).toHaveAttribute("aria-hidden", "true");
    expect(styleOf(count).backgroundColor).toBe(rgb(token("--color-signal")));
    expect(styleOf(count).fontWeight).toBe("600");
    expect(styleOf(count).paddingLeft).toBe("5px");
  });

  it("hides at zero", async () => {
    const screen = await render(<Count count={0} />);
    expect(screen.container.textContent).toBe("");
  });
});

describe("Panel", () => {
  it("groups content under its title with a slot on the right", async () => {
    const screen = await render(
      <Panel title="Cheapest landed" aside={<Badge tone={BadgeTone.Live}>Live</Badge>}><p>€44.40</p></Panel>,
    );
    const panel = screen.getByRole("region", { name: "Cheapest landed" });
    await expect.element(panel.getByText("€44.40")).toBeVisible();
    await expect.element(panel.getByText("Live")).toBeVisible();
    expect(hasBrackets(panel)).toBe(false);
  });

  it("frames the featured panel in reticle brackets", async () => {
    const screen = await render(<Panel title="New cheapest" featured>€41.90</Panel>);
    const panel = screen.getByRole("region", { name: "New cheapest" });
    expect(hasBrackets(panel)).toBe(true);
    expect(styleOf(panel).borderTopColor).toBe(rgb(token("--color-line-strong")));
  });

  it("can hold content without a title", async () => {
    const screen = await render(<Panel>Chart</Panel>);
    await expect.element(screen.getByText("Chart")).toBeVisible();
    await expect.element(screen.getByRole("region")).not.toBeInTheDocument();
  });
});

describe("Notice", () => {
  it("announces a refusal as an alert, tagged and on the critical tint", async () => {
    const screen = await render(
      <Notice tone={NoticeTone.Critical} tag="Refused">No plugin handles this store.</Notice>,
    );
    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Refused No plugin handles this store.");
    expect(styleOf(alert.getByText("No plugin handles this store.")).color).toBe(rgb(token("--color-ink")));
    expect(styleOf(alert.getByText("Refused")).color).toBe(rgb(token("--color-critical")));
  });

  it.each([NoticeTone.Status, NoticeTone.Warning])("announces a %s notice politely", async (tone) => {
    const screen = await render(<Notice tone={tone} tag="Done">Now watching TBS Source One V5.</Notice>);
    await expect.element(screen.getByRole("status")).toHaveTextContent("Done Now watching TBS Source One V5.");
  });

  it.each([null, undefined, false, ""])("stays mounted and empty with %j to say, so later text is announced",
    async (nothing) => {
      const screen = await render(<Notice tone={NoticeTone.Status} tag="Done">{nothing}</Notice>);
      await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
    });

  it("gives its message the id it is given, so a control can be described by it", async () => {
    const screen = await render(
      <>
        <input aria-label="Store URL" aria-describedby="refusal" />
        <Notice tone={NoticeTone.Critical} tag="Refused" id="refusal">No plugin handles this store.</Notice>
      </>,
    );
    await expect.element(screen.getByRole("textbox")).toHaveAccessibleDescription("No plugin handles this store.");
  });

  it("mounts a new live region when its tone changes, so the new role is announced", async () => {
    const screen = await render(<Notice tone={NoticeTone.Status} tag="Saving">Saving…</Notice>);
    const status = screen.getByRole("status").element();
    await screen.rerender(<Notice tone={NoticeTone.Critical} tag="Failed">Not saved.</Notice>);
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Failed Not saved.");
    expect(status.isConnected).toBe(false);
  });
});

describe("Empty state", () => {
  it("says what to do next under its tag, beside a crosshair", async () => {
    const screen = await render(
      <EmptyState tag={EmptyTag.NoSignal}>Nothing is watched yet. Paste a store URL above to start.</EmptyState>,
    );
    await expect.element(screen.getByText("Nothing is watched yet", { exact: false })).toBeVisible();
    expect(styleOf(screen.getByText(EmptyTag.NoSignal)).textTransform).toBe("uppercase");
    const mark = screen.container.querySelector("[aria-hidden='true']");
    expect(mark === null ? "" : getComputedStyle(mark, "::before").backgroundColor)
      .toBe(rgb(token("--color-line-strong")));
  });
});
