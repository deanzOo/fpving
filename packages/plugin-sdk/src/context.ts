import type { StoreErrorKind } from "./errors.js";
import type { CountryCode, CurrencyCode } from "./iso.js";
import type { Result } from "./result.js";

/**
 * Why the host could not complete a request. Its kinds are a subset of {@link StoreErrorKind}, so a store can return
 * it unchanged: `if (!response.ok) return err(response.error)`.
 */
export interface TransportError {
  /** `timeout` when the host's deadline elapsed, `network` for any other transport failure. */
  readonly kind: typeof StoreErrorKind.Timeout | typeof StoreErrorKind.Network;
  /** Human-readable reason for logs. */
  readonly detail: string;
}

/** Optional settings for {@link HttpClient.get}. */
export interface HttpRequestOptions {
  /** Extra request headers, for example `accept: application/json`. The host sets the user-agent. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** A completed HTTP response. Any status counts as completed; a 404 is a response, not a {@link TransportError}. */
export interface HttpResponse {
  /** The HTTP status code. */
  readonly status: number;
  /** The response body decoded as text. */
  readonly body: string;
  /** Response headers with lowercase names. */
  readonly headers: Readonly<Record<string, string>>;
}

/** Plain HTTP access provided by the host, which applies per-domain rate limits, jitter and timeouts. */
export interface HttpClient {
  /** Sends a GET request to an absolute http(s) URL and resolves to the response or a {@link TransportError}. */
  get(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, TransportError>>;
}

/** A page rendered by the host browser. */
export interface BrowserPage {
  /** The HTTP status code of the main document. */
  readonly status: number;
  /** The rendered document as HTML. */
  readonly html: string;
  /** The absolute URL after redirects. */
  readonly finalUrl: string;
}

/** A real browser provided by the host for pages that need JavaScript; the host owns the browser profile. */
export interface BrowserDriver {
  /** Loads and renders an absolute http(s) URL and resolves to the page or a {@link TransportError}. */
  fetchPage(url: string): Promise<Result<BrowserPage, TransportError>>;
}

/** Structured log fields. Never put secrets, cookies or page bodies in them. */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

/** Structured logger provided by the host. */
export interface Logger {
  /** Logs detail useful only when diagnosing a plugin. */
  debug(message: string, fields?: LogFields): void;
  /** Logs a normal event. */
  info(message: string, fields?: LogFields): void;
  /** Logs something unexpected that the plugin recovered from. */
  warn(message: string, fields?: LogFields): void;
  /** Logs a failure. */
  error(message: string, fields?: LogFields): void;
}

/** The host's clock. Use it instead of `Date.now()` so tests can fix the time. */
export interface Clock {
  /** The current time. */
  now(): Date;
}

/**
 * Everything the host gives a store. Plugins never bring their own HTTP client or browser, so the host can enforce
 * rate limits, timeouts and one browser profile.
 *
 * @remarks
 * Every value crossing the host and plugin boundary is plain data that survives `structuredClone`, because plugins
 * are designed to run in worker threads. URLs are therefore absolute http(s) URL strings, never `URL` objects. Host
 * methods resolve to a `Result` and never reject.
 */
export interface PluginContext {
  /** Plain HTTP access. */
  readonly http: HttpClient;
  /** A rendering browser for pages that need JavaScript. */
  readonly browser: BrowserDriver;
  /** Structured logger. */
  readonly logger: Logger;
  /** The host clock. */
  readonly clock: Clock;
  /** The destination country prices and shipping should be quoted for. */
  readonly shipTo: CountryCode;
  /** The currency the user prefers, for stores that let the shopper pick one. Report prices in the store's currency. */
  readonly currencyPreference: CurrencyCode;
}
