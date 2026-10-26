import type { Money, Result } from "@fpving/plugin-sdk";
import { err, ok } from "@fpving/plugin-sdk";
import { convert } from "./fx.js";
import type { FxTable, MissingRate } from "./fx.js";
import { roundMinor } from "./money.js";

const BASIS_POINTS_PER_UNIT = 10_000;

/** What the duty-free threshold is compared against: the item price alone, or the item price plus shipping. */
export const ThresholdBasis = { Item: "item", ItemAndShipping: "item_and_shipping" } as const;

/** One of the {@link ThresholdBasis} values. */
export type ThresholdBasis = (typeof ThresholdBasis)[keyof typeof ThresholdBasis];

/**
 * A country's import VAT rule. VAT applies when the {@link ThresholdBasis} amount is above `dutyFreeThreshold`.
 * `vatBasisPoints` is the rate in hundredths of a percent, so 1800 is 18%, which keeps the rate an exact integer.
 */
export interface ImportTaxRule {
  dutyFreeThreshold: Money;
  vatBasisPoints: number;
  thresholdBasis: ThresholdBasis;
}

/**
 * Import VAT owed on an item and its shipping, in the item's currency. The basis amount, converted to the
 * threshold's currency, at or below the threshold is exempt and owes `0`. Above it, VAT is `vatBasisPoints` of
 * item plus shipping, rounded half-up to a minor unit.
 */
export const importTax = (
  item: Money,
  shipping: Money,
  rule: ImportTaxRule,
  rates: FxTable,
): Result<Money, MissingRate> => {
  const shippingInItemCurrency = convert(shipping, item.currency, rates);
  if (!shippingInItemCurrency.ok) {
    return err(shippingInItemCurrency.error);
  }
  const taxable = { amountMinor: item.amountMinor + shippingInItemCurrency.value.amountMinor, currency: item.currency };
  const basis = rule.thresholdBasis === ThresholdBasis.Item ? item : taxable;
  const basisInThresholdCurrency = convert(basis, rule.dutyFreeThreshold.currency, rates);
  if (!basisInThresholdCurrency.ok) {
    return err(basisInThresholdCurrency.error);
  }
  const exempt = basisInThresholdCurrency.value.amountMinor <= rule.dutyFreeThreshold.amountMinor;
  const amountMinor = exempt ? 0 : roundMinor((taxable.amountMinor * rule.vatBasisPoints) / BASIS_POINTS_PER_UNIT);
  return ok({ amountMinor, currency: item.currency });
};
