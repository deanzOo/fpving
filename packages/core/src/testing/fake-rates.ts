import type { Result } from "@fpving/plugin-sdk";
import type { CurrencyRates, RatesUnavailable } from "../ports/currency-rates.js";
import type { FxTable } from "../pricing/fx.js";

/** A {@link CurrencyRates} that always answers `answer`. */
export const fakeCurrencyRates = (answer: Result<FxTable, RatesUnavailable>): CurrencyRates => ({
  fetchLatest: async () => Promise.resolve(answer),
});
