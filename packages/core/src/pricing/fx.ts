import { CURRENCY_MINOR_UNITS, currencyCodeSchema, err, ok } from "@fpving/plugin-sdk";
import { z } from "zod";
import type { Amount, CurrencyCode, Result } from "@fpving/plugin-sdk";
import { PricingErrorKind } from "./errors.js";
import { roundMinor, toAmount } from "./money.js";
import type { AmountOutOfRange } from "./money.js";

const DECIMAL_BASE = 10;

/**
 * Exchange rates at one point in time. `ratesPerBase` holds units of each currency per one unit of `base`, which
 * implicitly has the rate 1; every rate is positive and finite. `fetchedOn` is the ISO date (`YYYY-MM-DD`) the rates
 * were published.
 */
export const fxTableSchema = z.object({
  base: currencyCodeSchema,
  ratesPerBase: z.partialRecord(currencyCodeSchema, z.number().positive()),
  fetchedOn: z.iso.date(),
});

/** An exchange rate table as {@link fxTableSchema} accepts it. */
export type FxTable = z.infer<typeof fxTableSchema>;

/** A conversion needed the rate of `currency` and the table had none. */
export interface MissingRate {
  kind: typeof PricingErrorKind.MissingRate;
  currency: CurrencyCode;
}

/** Why a pricing computation could not produce an amount: a missing exchange rate or an unrepresentable result. */
export type PricingError = MissingRate | AmountOutOfRange;

const rateFor = (currency: CurrencyCode, rates: FxTable): number | undefined => {
  if (currency === rates.base) {
    return 1;
  }
  const rate = rates.ratesPerBase[currency];
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : undefined;
};

const minorPerMajor = (currency: CurrencyCode): number => DECIMAL_BASE ** CURRENCY_MINOR_UNITS[currency];

/**
 * Converts to `to` without rounding, in fractional minor units of `to`, so callers can compare exactly. The
 * source and target exponents (JPY 0, USD 2, KWD 3) and rates are folded into one division to limit float error.
 * Converting to the amount's own currency returns it unchanged and needs no rate; otherwise a currency without a
 * usable rate yields `missing_rate`, checking the source before the target.
 */
export const convertExact = (amount: Amount, to: CurrencyCode, rates: FxTable): Result<number, MissingRate> => {
  if (amount.currency === to) {
    return ok(amount.amountMinor);
  }
  const fromRate = rateFor(amount.currency, rates);
  if (fromRate === undefined) {
    return err({ kind: PricingErrorKind.MissingRate, currency: amount.currency });
  }
  const toRate = rateFor(to, rates);
  if (toRate === undefined) {
    return err({ kind: PricingErrorKind.MissingRate, currency: to });
  }
  return ok((amount.amountMinor * toRate * minorPerMajor(to)) / (fromRate * minorPerMajor(amount.currency)));
};

/**
 * Converts an amount into another currency through the table's base, rounding half-up to minor units. A result
 * that rounds to zero is a valid zero amount, not an error. Converting to the amount's own currency returns it
 * unchanged and needs no rate. A currency without a usable rate yields `missing_rate`, and a result that is not
 * a safe integer yields `amount_out_of_range`.
 */
export const convert = (amount: Amount, to: CurrencyCode, rates: FxTable): Result<Amount, PricingError> => {
  const exact = convertExact(amount, to, rates);
  return exact.ok ? toAmount(roundMinor(exact.value), to) : err(exact.error);
};
