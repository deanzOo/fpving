import { err, ok, StoreErrorKind } from "@fpving/plugin-sdk";
import type { HttpClient, HttpResponse, Result, TransportError } from "@fpving/plugin-sdk";
import type { DomainLimiter } from "./domain-limiter.js";
import { transportFailure } from "./transport-failure.js";
import { checkUrl, guardUrl } from "./url-policy.js";

/** How long a request may take before it is a `timeout`: fifteen seconds. */
export const HTTP_TIMEOUT_MS = 15_000;

/** How many redirects one request follows before it is a `network` error. */
export const MAX_REDIRECTS = 10;

const RedirectStatus = { Moved: 301, Found: 302, SeeOther: 303, Temporary: 307, Permanent: 308 } as const;
const REDIRECT_STATUSES: readonly number[] = Object.values(RedirectStatus);

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

const networkError = (detail: string): Result<never, TransportError> => err({ kind: StoreErrorKind.Network, detail });

const redirectTarget = (response: Response, from: string): string | null => {
  const location = response.headers.get("location");
  return REDIRECT_STATUSES.includes(response.status) && location !== null ? new URL(location, from).href : null;
};

const fetchFollowing = async (
  options: FetchHttpClientOptions,
  url: string,
  init: RequestInit,
): Promise<Result<Response, TransportError>> => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await options.fetch(current, init);
    const next = redirectTarget(response, current);
    if (next === null) {
      return ok(response);
    }
    await response.body?.cancel();
    const checked = checkUrl(next, options.allowPrivateHosts ?? false);
    if (!checked.ok) {
      return networkError(`${checked.error}; redirect to ${next}`);
    }
    current = checked.value;
  }
  return networkError("too many redirects");
};

const isTimeout = (error: unknown): boolean => error instanceof DOMException && error.name === "TimeoutError";

/**
 * Creates the SDK {@link HttpClient} on `fetch`. Any status is a completed response, including 404 and 403, because
 * plugins decide what those mean; only a deadline or a transport failure is an error. Redirects are followed here, up
 * to {@link MAX_REDIRECTS}, and each `Location` is resolved against the URL that sent it and checked like the first.
 *
 * @param options - The injected `fetch`, limiter and user agent.
 * @returns The client.
 */
export const createFetchHttpClient = (options: FetchHttpClientOptions): HttpClient => ({
  get: async (url, requestOptions) =>
    guardUrl(url, options.allowPrivateHosts, async (target) =>
      options.limiter.run(target, async (): Promise<Result<HttpResponse, TransportError>> => {
        const headers = new Headers(requestOptions?.headers);
        headers.set("user-agent", options.userAgent);
        try {
          const followed = await fetchFollowing(options, target, {
            headers,
            redirect: "manual",
            signal: AbortSignal.timeout(options.timeoutMs ?? HTTP_TIMEOUT_MS),
          });
          if (!followed.ok) {
            return followed;
          }
          const response = followed.value;
          const body = await response.text();
          return ok({ status: response.status, body, headers: Object.fromEntries(response.headers.entries()) });
        } catch (error) {
          return transportFailure(isTimeout(error), error);
        }
      }),
    ),
});
