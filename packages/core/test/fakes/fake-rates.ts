import type { CurrencyRates, FxTable, RatesUnavailable, Result } from "../../src/index.ts";

/** A {@link CurrencyRates} that always answers `answer`. */
export const fakeCurrencyRates = (answer: Result<FxTable, RatesUnavailable>): CurrencyRates => ({
  fetchLatest: async () => Promise.resolve(answer),
});
