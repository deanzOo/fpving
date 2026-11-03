import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ButtonSize } from "../../src/ui/button.tsx";
import { Confirm } from "../../src/ui/confirm.tsx";
import { Theme } from "../../src/ui/theme.ts";
import { rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const SMALL_HEIGHT = "28px";
const QUESTION = "Stop watching TBS Source One V5? Its price history is kept.";

const confirm = async (pending = false) => {
  const onConfirm = vi.fn();
  const screen = await render(
    <Confirm
      action="Stop watching"
      question={QUESTION}
      confirm="Stop watching"
      pending={pending}
      onConfirm={onConfirm}
    />,
  );
  return { screen, onConfirm, trigger: screen.getByRole("button", { name: "Stop watching" }) };
};

describe("Confirm", () => {
  it("asks first in a modal dialog with Cancel focused, raised on the one shadow over the scrim", async () => {
    const { screen, trigger } = await confirm();
    await trigger.click();
    const dialog = screen.getByRole("dialog", { name: QUESTION });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Cancel" })).toHaveFocus();
    const style = styleOf(dialog);
    expect(style.backgroundColor).toBe(rgb(token("--color-surface-raised")));
    expect(style.boxShadow).not.toBe("none");
    expect(styleOf(dialog, "::backdrop").backgroundColor).toBe(rgb(token("--color-scrim")));
  });

  it("casts the dark theme's shadow in the dark theme", async () => {
    document.documentElement.dataset["theme"] = Theme.Dark;
    try {
      const { screen, trigger } = await confirm();
      await trigger.click();
      expect(styleOf(screen.getByRole("dialog")).boxShadow).toContain("rgba(0, 0, 0, 0.55)");
    } finally {
      delete document.documentElement.dataset["theme"];
    }
  });

  it("closes on Escape and gives focus back to the trigger without acting", async () => {
    const { screen, trigger, onConfirm } = await confirm();
    await trigger.click();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("acts when the danger button repeats the verb", async () => {
    const { screen, trigger, onConfirm } = await confirm();
    await trigger.click();
    const danger = screen.getByRole("dialog").getByRole("button", { name: "Stop watching" });
    expect(styleOf(danger).backgroundColor).toBe(rgb(token("--color-critical")));
    await danger.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the trigger focusable but inert while pending", async () => {
    const { screen, trigger } = await confirm(true);
    await expect.element(trigger).toHaveAttribute("aria-disabled", "true");
    await trigger.click({ force: true });
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("says what it is doing on the trigger while pending", async () => {
    const screen = await render(
      <Confirm
        action="Remove"
        actionLabel="Remove fpv-shop: Source One V5"
        question={QUESTION}
        confirm="Remove"
        pending
        pendingLabel="Removing…"
        onConfirm={() => undefined}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Remove fpv-shop: Source One V5" });
    await expect.element(trigger).toHaveTextContent("Removing…");
    await expect.element(trigger).toHaveAttribute("aria-disabled", "true");
  });

  it("takes a small trigger for a table row", async () => {
    const screen = await render(
      <Confirm
        action="Remove"
        question={QUESTION}
        confirm="Remove"
        pending={false}
        size={ButtonSize.Small}
        onConfirm={() => undefined}
      />,
    );
    expect(styleOf(screen.getByRole("button", { name: "Remove" })).height).toBe(SMALL_HEIGHT);
  });
});
