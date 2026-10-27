import { ok } from "@fpving/plugin-sdk";
import type { HttpClient, HttpResponse, Result, TransportError } from "@fpving/plugin-sdk";
import type { DomainLimiter } from "./domain-limiter.js";
import { transportFailure } from "./transport-failure.js";
import { urlRefusal } from "./url-policy.js";

/** How long a request may take before it is a `timeout`: fifteen seconds. */
export const HTTP_TIMEOUT_MS = 15_000;

/** The part of `fetch` the client uses, so tests can inject a fake. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** What {@link createFetchHttpClient} needs. */
export interface FetchHttpClientOptions {
  /** Sends the request, normally the global `fetch`. */
  readonly fetch: FetchFn;
  /** Spaces out requests per host; share it with the browser driver. */
  readonly limiter: DomainLimiter;
  /** The fixed user agent, see `createUserAgent`. It replaces any a plugin supplies. */
  readonly userAgent: string;
  /** The request deadline; defaults to {@link HTTP_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Lets loopback, private and link-local hosts through; false unless a test needs a local server. */
  readonly allowPrivateHosts?: boolean;
}

const isTimeout = (error: unknown): boolean => error instanceof DOMException && error.name === "TimeoutError";

/**
 * Creates the SDK {@link HttpClient} on `fetch`. Any status is a completed response, including 404 and 403, because
 * plugins decide what those mean; only a deadline or a transport failure is an error.
 *
 * @param options - The injected `fetch`, limiter and user agent.
 * @returns The client.
 */
export const createFetchHttpClient = (options: FetchHttpClientOptions): HttpClient => ({
  get: async (url, requestOptions) => {
    const refusal = urlRefusal(url, options.allowPrivateHosts ?? false);
    if (refusal !== undefined) {
      return transportFailure(false, refusal);
    }
    return options.limiter.run(url, async (): Promise<Result<HttpResponse, TransportError>> => {
      const headers = new Headers(requestOptions?.headers);
      headers.set("user-agent", options.userAgent);
      try {
        const response = await options.fetch(url, {
          headers,
          signal: AbortSignal.timeout(options.timeoutMs ?? HTTP_TIMEOUT_MS),
        });
        const body = await response.text();
        return ok({ status: response.status, body, headers: Object.fromEntries(response.headers.entries()) });
      } catch (error) {
        return transportFailure(isTimeout(error), error);
      }
    });
  },
});
