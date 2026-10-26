import type { CountryCode, CurrencyCode } from "../iso.js";
import type { SearchQuery } from "../plugin.js";

/** A response the contract kit serves for one URL, through both the fake HTTP client and the fake browser. */
export interface FixturePage {
  /** The HTTP status code. */
  readonly status: number;
  /** The body, served as `body` by the HTTP client and as `html` by the browser. */
  readonly body: string;
}

/**
 * Saved store pages for the contract kit. Capture them from the real store; a `parse_failed` error's `rawPage` is a
 * ready-made fixture.
 */
export interface ContractFixtures {
  /** The destination country the pages were captured for. */
  readonly shipTo: CountryCode;
  /** The currency preference the pages were captured with. */
  readonly currencyPreference: CurrencyCode;
  /**
   * Every page the plugin may request, keyed by absolute URL. A request for any other URL fails with a `network`
   * error naming the missing URL.
   */
  readonly pages: Readonly<Record<string, FixturePage>>;
  /** The product URLs passed to {@link Store.fetchListing}, one per scenario. */
  readonly listings: {
    /** A product page that is in stock. */
    readonly inStock: string;
    /** A product page that is out of stock. */
    readonly outOfStock: string;
    /** A page served with HTTP 404. */
    readonly notFound: string;
    /** A captcha or bot-wall page. */
    readonly captcha: string;
    /** A page the plugin cannot parse, such as a redesigned layout. */
    readonly garbage: string;
  };
  /** The query passed to {@link Store.search}. Required when the manifest declares `search`. */
  readonly searchQuery?: SearchQuery;
}
