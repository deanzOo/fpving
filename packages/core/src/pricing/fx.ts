import { CURRENCY_MINOR_UNITS, err, ok } from "@fpving/plugin-sdk";
import type { CurrencyCode, Money, Result } from "@fpving/plugin-sdk";
import { roundMinor } from "./money.js";

const DECIMAL_BASE = 10;

/**
 * Exchange rates at one point in time. `ratesPerBase` holds units of each currency per one unit of `base`, which
 * implicitly has the rate 1. `fetchedOn` is the ISO date the rates were published.
 */
export interface FxTable {
  base: CurrencyCode;
  ratesPerBase: Partial<Record<CurrencyCode, number>>;
  fetchedOn: string;
}

/** A conversion needed the rate of `currency` and the table had none. */
export interface MissingRate {
  kind: "missing_rate";
  currency: CurrencyCode;
}

const rateFor = (currency: CurrencyCode, rates: FxTable): number | undefined => {
  if (currency === rates.base) {
    return 1;
  }
  const rate = rates.ratesPerBase[currency];
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : undefined;
};

const minorPerMajor = (currency: CurrencyCode): number => DECIMAL_BASE ** CURRENCY_MINOR_UNITS[currency];

/**
 * Converts a price into another currency through the table's base, going via major units so currencies with
 * different minor-unit exponents (JPY 0, USD 2, KWD 3) convert correctly. The result is rounded half-up to minor
 * units. Converting to the price's own currency returns it unchanged and needs no rate. A currency without a
 * usable rate yields `missing_rate`, checking the source before the target.
 */
export const convert = (money: Money, to: CurrencyCode, rates: FxTable): Result<Money, MissingRate> => {
  if (money.currency === to) {
    return ok(money);
  }
  const fromRate = rateFor(money.currency, rates);
  if (fromRate === undefined) {
    return err({ kind: "missing_rate", currency: money.currency });
  }
  const toRate = rateFor(to, rates);
  if (toRate === undefined) {
    return err({ kind: "missing_rate", currency: to });
  }
  const major = money.amountMinor / minorPerMajor(money.currency) / fromRate;
  return ok({ amountMinor: roundMinor(major * toRate * minorPerMajor(to)), currency: to });
};
