import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { takeLogged } from "../support/console-guard.ts";
import { applyTheme, readTheme, Theme, THEME_KEY } from "../../src/ui/theme.ts";

declare module "vitest/browser" {
  interface BrowserCommands {
    themeAtFirstFrame: (key: string, stored: string) => Promise<unknown>;
  }
}

const BOOT = "/theme-boot.js";

const boot = async (): Promise<string | null> => {
  delete document.documentElement.dataset["theme"];
  const script = document.createElement("script");
  script.src = BOOT;
  const ran = new Promise((resolve, reject) => {
    script.addEventListener("load", resolve);
    script.addEventListener("error", reject);
  });
  document.head.append(script);
  await ran;
  script.remove();
  return document.documentElement.getAttribute("data-theme");
};

const app = (): string | null => {
  delete document.documentElement.dataset["theme"];
  applyTheme(readTheme());
  return document.documentElement.getAttribute("data-theme");
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("Theme boot script", () => {
  it.each([Theme.Light, Theme.Dark, Theme.System, "sepia", null])(
    "sets the same theme as the app for a stored %j",
    async (stored) => {
      if (stored !== null) {
        localStorage.setItem(THEME_KEY, stored);
      }
      const expected = app();
      expect(await boot()).toBe(expected);
    },
  );

  it("falls back to System like the app when the browser blocks storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(app()).toBeNull();
    expect(await boot()).toBeNull();
  });

  it("does not hide a storage failure that is not the browser refusing", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new TypeError("broken");
    });
    const thrown = new Promise<unknown>((resolve) => {
      window.addEventListener("error", (event) => {
        event.preventDefault();
        resolve(event.error);
      }, { once: true });
    });
    await boot();
    expect(await thrown).toBeInstanceOf(TypeError);
    expect(takeLogged().flat()).toContainEqual(expect.objectContaining({ message: "Uncaught TypeError: broken" }));
  });

  it("sets a stored theme before the page's first frame", async () => {
    expect(await commands.themeAtFirstFrame(THEME_KEY, Theme.Dark)).toBe(Theme.Dark);
  });
});
