import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThemeSwitch } from "../../src/ui/theme-switch.tsx";
import { applyTheme, readTheme, saveTheme, Theme } from "../../src/ui/theme.ts";
import { prefersColorScheme } from "../support/media.ts";
import "../../src/styles.css";

const KEY = "fpving.theme";
const LIGHT_PAGE = "#e9edf0";
const DARK_PAGE = "#0e1216";

const page = () => getComputedStyle(document.documentElement).getPropertyValue("--color-page");
const blockStorage = () => {
  for (const method of ["getItem", "setItem", "removeItem"] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("Theme switch", () => {
  it("is a labelled group of radios, System, Light and Dark with System chosen at first", async () => {
    const screen = await render(<ThemeSwitch />);
    const group = screen.getByRole("group", { name: "Theme" });
    await expect.element(group.getByRole("radio", { name: "System" })).toBeChecked();
    await expect.element(group.getByRole("radio", { name: "Light" })).not.toBeChecked();
    await expect.element(group.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("names the group for screen readers only, covering nothing on the page", async () => {
    const screen = await render(<ThemeSwitch />);
    const legend = screen.getByText("Theme", { exact: true }).element();
    expect(legend.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("leaves the colours to the system while System is chosen", async () => {
    await render(<ThemeSwitch />);
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    await prefersColorScheme("dark");
    expect(page()).toBe(DARK_PAGE);
    await prefersColorScheme("light");
    expect(page()).toBe(LIGHT_PAGE);
  });

  it("turns the page light when Light is chosen, whatever the system prefers", async () => {
    await prefersColorScheme("dark");
    const screen = await render(<ThemeSwitch />);
    await screen.getByRole("radio", { name: "Light" }).click();
    expect(document.documentElement).toHaveAttribute("data-theme", Theme.Light);
    expect(page()).toBe(LIGHT_PAGE);
  });

  it("turns the page dark when Dark is chosen, whatever the system prefers", async () => {
    await prefersColorScheme("light");
    const screen = await render(<ThemeSwitch />);
    await screen.getByRole("radio", { name: "Dark" }).click();
    expect(document.documentElement).toHaveAttribute("data-theme", Theme.Dark);
    expect(page()).toBe(DARK_PAGE);
  });

  it("moves between the choices with the arrow keys", async () => {
    const screen = await render(<ThemeSwitch />);
    await userEvent.tab();
    await expect.element(screen.getByRole("radio", { name: "System" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", Theme.Light);
  });

  it("remembers the choice for the next visit, and forgets it when System is chosen again", async () => {
    const screen = await render(<ThemeSwitch />);
    await screen.getByRole("radio", { name: "Dark" }).click();
    expect(localStorage.getItem(KEY)).toBe(Theme.Dark);
    await screen.unmount();
    const again = await render(<ThemeSwitch />);
    await expect.element(again.getByRole("radio", { name: "Dark" })).toBeChecked();
    await again.getByRole("radio", { name: "System" }).click();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("still switches, for this page only, when the browser blocks storage", async () => {
    blockStorage();
    const screen = await render(<ThemeSwitch />);
    await expect.element(screen.getByRole("radio", { name: "System" })).toBeChecked();
    await screen.getByRole("radio", { name: "Dark" }).click();
    expect(document.documentElement).toHaveAttribute("data-theme", Theme.Dark);
  });
});

describe("Stored theme", () => {
  it("reads as System when nothing, or something unknown, is stored", () => {
    expect(readTheme()).toBe(Theme.System);
    localStorage.setItem(KEY, "sepia");
    expect(readTheme()).toBe(Theme.System);
  });

  it("reads as System when the browser blocks storage", () => {
    blockStorage();
    expect(readTheme()).toBe(Theme.System);
  });

  it("does not hide a storage failure that is not the browser refusing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new TypeError("broken");
    });
    expect(() => {
      saveTheme(Theme.Dark);
    }).toThrow("broken");
  });

  it("is applied to the document before anything renders", () => {
    localStorage.setItem(KEY, Theme.Dark);
    applyTheme(readTheme());
    expect(document.documentElement).toHaveAttribute("data-theme", Theme.Dark);
    applyTheme(Theme.System);
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
