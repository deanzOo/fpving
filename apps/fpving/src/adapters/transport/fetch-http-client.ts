import { err, ok, StoreErrorKind } from "@fpving/plugin-sdk";
import type { HttpClient, HttpResponse, Result, TransportError } from "@fpving/plugin-sdk";
import type { DomainLimiter } from "./domain-limiter.js";
import { transportFailure } from "./transport-failure.js";
import { checkUrl, guardUrl } from "./url-policy.js";

/** How long a request may take before it is a `timeout`: fifteen seconds. */
export const HTTP_TIMEOUT_MS = 15_000;

/** The largest body the client reads, five megabytes; a larger one is a `network` error. */
export const MAX_BODY_BYTES = 5_242_880;

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
  /** Lets private, loopback, link-local and other non-public hosts through; false unless a test needs a local host. */
  readonly allowPrivateHosts?: boolean;
}

const CROSS_ORIGIN_DROPPED_HEADERS = ["authorization", "proxy-authorization", "cookie"] as const;

const withoutCredentials = (headers: RequestInit["headers"]): Headers => {
  const kept = new Headers(headers);
  for (const name of CROSS_ORIGIN_DROPPED_HEADERS) {
    kept.delete(name);
  }
  return kept;
};

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
  let hopInit = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await options.fetch(current, hopInit);
    const next = redirectTarget(response, current);
    if (next === null) {
      return ok(response);
    }
    await response.body?.cancel();
    const checked = checkUrl(next, options.allowPrivateHosts ?? false);
    if (!checked.ok) {
      return networkError(`${checked.error}; redirect to ${next}`);
    }
    if (new URL(checked.value).origin !== new URL(current).origin) {
      hopInit = { ...hopInit, headers: withoutCredentials(hopInit.headers) };
    }
    current = checked.value;
  }
  return networkError("too many redirects");
};

const readCapped = async (response: Response): Promise<Result<string, TransportError>> => {
  if (response.body === null) {
    return ok("");
  }
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let text = "";
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    const bytes: unknown = chunk.value;
    if (!(bytes instanceof Uint8Array)) {
      await reader.cancel();
      return networkError("response body is not bytes");
    }
    size += bytes.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return networkError("response too large");
    }
    text += decoder.decode(bytes, { stream: true });
  }
  return ok(text + decoder.decode());
};

const isTimeout = (error: unknown): boolean => error instanceof DOMException && error.name === "TimeoutError";

/**
 * Creates the SDK {@link HttpClient} on `fetch`. Any status is a completed response, including 404 and 403, because
 * plugins decide what those mean; only a deadline or a transport failure is an error. Redirects are followed here, up
 * to {@link MAX_REDIRECTS}, and each `Location` is resolved against the URL that sent it and checked like the first.
 * Once a redirect leaves the origin, `authorization`, `proxy-authorization` and `cookie` are no longer sent.
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
          const body = await readCapped(response);
          if (!body.ok) {
            return body;
          }
          const responseHeaders = Object.fromEntries(response.headers.entries());
          return ok({ status: response.status, body: body.value, headers: responseHeaders });
        } catch (error) {
          return transportFailure(isTimeout(error), error);
        }
      }),
    ),
});
