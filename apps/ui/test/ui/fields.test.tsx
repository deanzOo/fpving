import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Checkbox } from "../../src/ui/checkbox.tsx";
import { Select } from "../../src/ui/select.tsx";
import { TextField } from "../../src/ui/text-field.tsx";
import { hasBrackets, rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const HINT = "At most 2 decimals.";
const ERROR = "Enter a whole number of hours, at least 1.";

describe("Text field", () => {
  it("names the input by its label and describes it with the hint", async () => {
    const screen = await render(<TextField label="VAT (%)" hint={HINT} defaultValue="20.00" />);
    const input = screen.getByRole("textbox", { name: "VAT (%)" });
    await expect.element(input).toHaveAccessibleDescription(HINT);
    await expect.element(input).not.toHaveAttribute("aria-invalid");
  });

  it("replaces the hint with the error, marks the input invalid and draws its border critical", async () => {
    const screen = await render(<TextField label="Scan every (hours)" hint={HINT} error={ERROR} />);
    const input = screen.getByRole("textbox", { name: "Scan every (hours)" });
    await expect.element(input).toHaveAccessibleDescription(ERROR);
    await expect.element(input).toHaveAttribute("aria-invalid", "true");
    await expect.element(screen.getByText(HINT)).not.toBeInTheDocument();
    expect(styleOf(input).borderTopColor).toBe(rgb(token("--color-critical")));
  });

  it("has no description without a hint or an error", async () => {
    const screen = await render(<TextField label="Store URL" />);
    await expect.element(screen.getByRole("textbox")).not.toHaveAttribute("aria-describedby");
  });

  it("types numbers in the readout face", async () => {
    const screen = await render(<TextField label="VAT (%)" numeric />);
    expect(styleOf(screen.getByRole("textbox")).fontFamily).toContain("Martian Mono");
  });

  it("passes typing to its change handler", async () => {
    const change = vi.fn();
    const screen = await render(<TextField label="Store URL" onChange={change} />);
    await userEvent.type(screen.getByRole("textbox"), "x");
    expect(change).toHaveBeenCalled();
  });

  it("frames the focused control in reticle brackets", async () => {
    const screen = await render(<TextField label="Store URL" />);
    await userEvent.tab();
    const frame = screen.getByRole("textbox").element().parentElement;
    expect(frame === null ? "none" : getComputedStyle(frame, "::after").content).not.toBe("none");
    expect(frame === null ? "" : getComputedStyle(frame).outlineStyle).toBe("none");
    expect(styleOf(screen.getByRole("textbox")).outlineStyle).toBe("none");
  });
});

describe("Select", () => {
  it("names the select by its label, describes it and lists its options", async () => {
    const screen = await render(
      <Select label="Display currency" hint="Prices show in this currency." defaultValue="USD">
        <option>EUR</option>
        <option>USD</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Display currency" });
    await expect.element(select).toHaveAccessibleDescription("Prices show in this currency.");
    await expect.element(select).toHaveValue("USD");
    await userEvent.selectOptions(select, "EUR");
    await expect.element(select).toHaveValue("EUR");
  });

  it("marks the select invalid with its error", async () => {
    const screen = await render(<Select label="Ship to" error="Choose a country."><option>DE</option></Select>);
    const select = screen.getByRole("combobox", { name: "Ship to" });
    await expect.element(select).toHaveAttribute("aria-invalid", "true");
    await expect.element(select).toHaveAccessibleDescription("Choose a country.");
  });
});

describe("Checkbox", () => {
  it("is named by its label, which is the whole hit target", async () => {
    const change = vi.fn();
    const screen = await render(<Checkbox label="Unread only" checked={false} onChange={change} />);
    await screen.getByText("Unread only").click();
    expect(change).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("checkbox", { name: "Unread only" })).not.toBeChecked();
  });

  it("fills with the signal colour when checked", async () => {
    const screen = await render(<Checkbox label="Unread only" checked onChange={() => undefined} />);
    const box = screen.getByRole("checkbox", { name: "Unread only" });
    await expect.element(box).toBeChecked();
    expect(styleOf(box).backgroundColor).toBe(rgb(token("--color-signal")));
  });

  it("toggles with the space key and frames box and label when focused", async () => {
    const change = vi.fn();
    const screen = await render(<Checkbox label="Show candidates judged different" onChange={change} />);
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(change).toHaveBeenCalledOnce();
    expect(hasBrackets(screen.getByText("Show candidates judged different"))).toBe(true);
  });

  it("describes the box with its hint or error", async () => {
    const screen = await render(<Checkbox label="Notify me" error="Set a notifier first." />);
    const box = screen.getByRole("checkbox", { name: "Notify me" });
    await expect.element(box).toHaveAccessibleDescription("Set a notifier first.");
    await expect.element(box).toHaveAttribute("aria-invalid", "true");
  });
});
