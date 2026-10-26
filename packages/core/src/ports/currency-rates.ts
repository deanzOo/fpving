import type { Result } from "@fpving/plugin-sdk";
import type { FxTable } from "../pricing/fx.js";

/** The rates source could not be reached or answered something unusable; `detail` is for logs. */
export interface RatesUnavailable {
  readonly kind: "rates_unavailable";
  readonly detail: string;
}

/** A source of exchange rates. */
export interface CurrencyRates {
  /** Fetches the latest published rates. Resolves to a `Result` and never rejects. */
  fetchLatest(): Promise<Result<FxTable, RatesUnavailable>>;
}
