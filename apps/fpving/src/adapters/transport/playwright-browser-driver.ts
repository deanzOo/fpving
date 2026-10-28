import { errors } from "playwright";
import { ok } from "@fpving/plugin-sdk";
import type { BrowserDriver, BrowserPage, Result, TransportError } from "@fpving/plugin-sdk";
import type { DomainLimiter } from "./domain-limiter.js";
import { transportFailure } from "./transport-failure.js";
import { checkUrl, guardUrl } from "./url-policy.js";

/** How long a navigation may take before it is a `timeout`: thirty seconds. */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/** The part of a Playwright `Page` the driver uses. */
export interface BrowserPageHandle {
  goto(url: string, options: { timeout: number; waitUntil: "load" }): Promise<{ status(): number } | null>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

/** The part of a Playwright `Route` the driver uses: one intercepted request the page made. */
export interface RouteHandle {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

/** The part of a Playwright `BrowserContext` the driver uses. */
export interface BrowserContextHandle {
  route(url: string, handler: (route: RouteHandle) => Promise<void>): Promise<unknown>;
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
  /** Lets private, loopback, link-local and other non-public hosts through; false unless a test needs a local host. */
  readonly allowPrivateHosts?: boolean;
}

/** A {@link BrowserDriver} that owns a browser the host must shut down. */
export interface ClosableBrowserDriver extends BrowserDriver {
  /** Closes the browser context for good: later pages are refused, and calling it again does nothing. */
  close(): Promise<void>;
}

const navigate = async (
  page: BrowserPageHandle,
  url: string,
  allowPrivateHosts: boolean,
): Promise<Result<BrowserPage, TransportError>> => {
  const response = await page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "load" });
  if (response === null) {
    return transportFailure(false, "navigation produced no response");
  }
  const finalUrl = page.url();
  const landed = checkUrl(finalUrl, allowPrivateHosts);
  if (!landed.ok) {
    return transportFailure(false, `${landed.error}; redirect to ${finalUrl}`);
  }
  return ok({ status: response.status(), html: await page.content(), finalUrl });
};

const load = async (
  context: BrowserContextHandle,
  url: string,
  allowPrivateHosts: boolean,
): Promise<Result<BrowserPage, TransportError>> => {
  const page = await context.newPage();
  let result: Result<BrowserPage, TransportError>;
  try {
    result = await navigate(page, url, allowPrivateHosts);
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
  await page.close();
  return result;
};

const refuseBlockedRequests = (allowPrivateHosts: boolean) => async (route: RouteHandle): Promise<void> =>
  checkUrl(route.request().url(), allowPrivateHosts).ok ? route.continue() : route.abort();

/**
 * Creates the SDK {@link BrowserDriver} on Playwright. One persistent context is launched on the first page and
 * reused; each page opens in a tab that is always closed again. Every request a page makes (subresources, XHR and
 * fetch) is routed through the URL policy and aborted when refused, and a navigation that was redirected to a refused
 * host is a `network` error. Playwright does not route redirect hops, so such a hop is still sent, but its response
 * never reaches the plugin.
 *
 * @param options - The launcher, limiter and profile directory.
 * @returns The driver, to be closed when the host shuts down.
 */
export const createPlaywrightBrowserDriver = (options: BrowserDriverOptions): ClosableBrowserDriver => {
  let pending: Promise<BrowserContextHandle> | undefined;
  let closed = false;
  const allowPrivateHosts = options.allowPrivateHosts ?? false;

  const context = async (): Promise<BrowserContextHandle> => {
    if (pending === undefined) {
      const launching: Promise<BrowserContextHandle> = options
        .launch(options.profileDir)
        .then(async (launched) => {
          await launched.route("**/*", refuseBlockedRequests(allowPrivateHosts));
          return launched;
        })
        .catch((error: unknown) => {
          if (pending === launching) {
            pending = undefined;
          }
          throw error;
        });
      pending = launching;
    }
    return pending;
  };

  return {
    fetchPage: async (url) =>
      guardUrl(url, options.allowPrivateHosts, async (target) =>
        options.limiter.run(target, async () => {
          if (closed) {
            return transportFailure(false, "browser closed");
          }
          try {
            return await load(await context(), target, allowPrivateHosts);
          } catch (error) {
            return transportFailure(error instanceof errors.TimeoutError, error);
          }
        }),
      ),
    close: async () => {
      closed = true;
      const launched = pending;
      pending = undefined;
      await launched?.then(
        async (launchedContext) => launchedContext.close(),
        () => undefined,
      );
    },
  };
};
