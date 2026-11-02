import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Button, ButtonSize, ButtonVariant } from "../../src/ui/button.tsx";
import { hasBrackets, rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const FULL = "1";
const SMALL_HEIGHT = "28px";

describe("Button", () => {
  it("is a plain button that runs its action on a click", async () => {
    const act = vi.fn();
    const screen = await render(<Button onClick={act}>Scan now</Button>);
    const button = screen.getByRole("button", { name: "Scan now" });
    await expect.element(button).toHaveAttribute("type", "button");
    await button.click({ force: true });
    expect(act).toHaveBeenCalledOnce();
  });

  it.each([
    [ButtonVariant.Primary, "--color-on-signal", "--color-signal"],
    [ButtonVariant.Secondary, "--color-ink", "--color-line-strong"],
    [ButtonVariant.Ghost, "--color-ink-muted", null],
    [ButtonVariant.Danger, "--color-on-critical", "--color-critical"],
  ])("draws the %s variant in its tokens", async (variant, ink, border) => {
    const screen = await render(<Button variant={variant}>Go</Button>);
    const style = styleOf(screen.getByRole("button"));
    expect(style.color).toBe(rgb(token(ink)));
    expect(style.borderTopColor).toBe(border === null ? "rgba(0, 0, 0, 0)" : rgb(token(border)));
  });

  it("is 28px tall at the small size, for rows", async () => {
    const screen = await render(<Button size={ButtonSize.Small}>Rename</Button>);
    expect(styleOf(screen.getByRole("button")).height).toBe(SMALL_HEIGHT);
  });

  it("while pending stays focusable, says what it is doing and ignores clicks, without fading", async () => {
    const act = vi.fn();
    const screen = await render(
      <Button variant={ButtonVariant.Primary} pending pendingLabel="Adding…" onClick={act}>Add product</Button>,
    );
    const button = screen.getByRole("button", { name: "Adding…" });
    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await button.click({ force: true });
    expect(act).not.toHaveBeenCalled();
    await expect.element(button).toHaveFocus();
    const style = styleOf(button);
    expect(style.opacity).toBe(FULL);
    expect(style.color).toBe(rgb(token("--color-ink-muted")));
    expect(styleOf(button, "::before").animationName).toBe("blink");
  });

  it("keeps its label while pending when it has no progress label", async () => {
    const screen = await render(<Button pending>Stop watching</Button>);
    await expect.element(screen.getByRole("button", { name: "Stop watching" })).toHaveAttribute("aria-disabled");
  });

  it("does not submit its form while pending", async () => {
    const submit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    const screen = await render(
      <form onSubmit={(event) => {
        submit(event.nativeEvent);
      }}
      >
        <Button type="submit" pending>Save</Button>
      </form>,
    );
    await screen.getByRole("button").click({ force: true });
    expect(submit).not.toHaveBeenCalled();
  });

  it("frames keyboard focus in reticle brackets and a signal outline", async () => {
    const screen = await render(<Button>Scan now</Button>);
    const button = screen.getByRole("button");
    expect(hasBrackets(button)).toBe(false);
    await userEvent.tab();
    expect(hasBrackets(button)).toBe(true);
    expect(styleOf(button).outlineColor).toBe(rgb(token("--color-signal")));
  });
});
