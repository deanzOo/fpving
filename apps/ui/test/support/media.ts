import type { Page } from "playwright";
import { afterEach } from "vitest";
import { commands } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateMedia: (...options: Parameters<Page["emulateMedia"]>) => Promise<void>;
  }
}

afterEach(async () => {
  await commands.emulateMedia({ colorScheme: null, reducedMotion: null });
});

/** Makes the browser report this colour scheme preference until the test ends. */
export const prefersColorScheme = async (colorScheme: "light" | "dark") => commands.emulateMedia({ colorScheme });

/** Makes the browser report a reduced motion preference until the test ends. */
export const prefersReducedMotion = async () => commands.emulateMedia({ reducedMotion: "reduce" });
