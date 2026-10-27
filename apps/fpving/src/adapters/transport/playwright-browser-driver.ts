import { errors } from "playwright";
import { ok } from "@fpving/plugin-sdk";
import type { BrowserDriver, BrowserPage, Result, TransportError } from "@fpving/plugin-sdk";
import type { DomainLimiter } from "./domain-limiter.js";
import { transportFailure } from "./transport-failure.js";

/** How long a navigation may take before it is a `timeout`: thirty seconds. */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/** The part of a Playwright `Page` the driver uses. */
export interface BrowserPageHandle {
  goto(url: string, options: { timeout: number; waitUntil: "load" }): Promise<{ status(): number } | null>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

/** The part of a Playwright `BrowserContext` the driver uses. */
export interface BrowserContextHandle {
  newPage(): Promise<BrowserPageHandle>;
  close(): Promise<void>;
}

/** Opens the persistent browser context whose profile lives in `userDataDir`. */
export type LaunchContext = (userDataDir: string) => Promise<BrowserContextHandle>;

/** What {@link createPlaywrightBrowserDriver} needs. */
export interface BrowserDriverOptions {
  /** Opens the context on first use, normally `launchChromium`. */
  readonly launch: LaunchContext;
  /** Spaces out requests per host; share it with the HTTP client. */
  readonly limiter: DomainLimiter;
  /** Absolute directory for the browser profile: cookies and storage survive restarts. */
  readonly profileDir: string;
}

/** A {@link BrowserDriver} that owns a browser the host must shut down. */
export interface ClosableBrowserDriver extends BrowserDriver {
  /** Closes the browser context; calling it again, or before any page was loaded, does nothing. */
  close(): Promise<void>;
}

const load = async (context: BrowserContextHandle, url: string): Promise<Result<BrowserPage, TransportError>> => {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "load" });
    if (response === null) {
      return transportFailure(false, "navigation produced no response");
    }
    return ok({ status: response.status(), html: await page.content(), finalUrl: page.url() });
  } finally {
    await page.close();
  }
};

/**
 * Creates the SDK {@link BrowserDriver} on Playwright. One persistent context is launched on the first page and
 * reused; each page opens in a tab that is always closed again.
 *
 * @param options - The launcher, limiter and profile directory.
 * @returns The driver, to be closed when the host shuts down.
 */
export const createPlaywrightBrowserDriver = (options: BrowserDriverOptions): ClosableBrowserDriver => {
  let pending: Promise<BrowserContextHandle> | undefined;

  const context = async (): Promise<BrowserContextHandle> => {
    pending ??= options.launch(options.profileDir).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };

  return {
    fetchPage: async (url) =>
      options.limiter.run(url, async () => {
        try {
          return await load(await context(), url);
        } catch (error) {
          return transportFailure(error instanceof errors.TimeoutError, error);
        }
      }),
    close: async () => {
      const launched = pending;
      pending = undefined;
      if (launched) {
        await (await launched).close();
      }
    },
  };
};
