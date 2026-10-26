import { z } from "zod";
import { amountSchema, err } from "@fpving/plugin-sdk";
import type { Amount, Money, Result } from "@fpving/plugin-sdk";
import { convert, convertExact } from "./fx.js";
import type { FxTable, PricingError } from "./fx.js";
import { roundMinor, toAmount } from "./money.js";

const BASIS_POINTS_PER_UNIT = 10_000;

/** What the duty-free threshold is compared against: the item price alone, or the item price plus shipping. */
export const ThresholdBasis = { Item: "item", ItemAndShipping: "item_and_shipping" } as const;

/** One of the {@link ThresholdBasis} values. */
export type ThresholdBasis = (typeof ThresholdBasis)[keyof typeof ThresholdBasis];

/**
 * A country's import VAT rule. VAT applies when the {@link ThresholdBasis} amount, compared unrounded, is above
 * `dutyFreeThreshold`. The threshold is an `Amount`, so it may be zero, which taxes everything from the first minor
 * unit. `vatBasisPoints` is the rate in hundredths of a percent, so 1800 is 18%, which keeps the rate an exact integer.
 */
export const importTaxRuleSchema = z.object({
  dutyFreeThreshold: amountSchema,
  vatBasisPoints: z.int().nonnegative(),
  thresholdBasis: z.enum(ThresholdBasis),
});

/** An import tax rule as {@link importTaxRuleSchema} accepts it. */
export type ImportTaxRule = z.infer<typeof importTaxRuleSchema>;

/**
 * Import VAT owed on an item and its shipping, in the item's currency; `0` when exempt. The basis amount,
 * converted unrounded to the threshold's currency, at or below the threshold is exempt, so exactly the threshold
 * is exempt and a fraction of a minor unit above it is not. Above it, VAT is `vatBasisPoints` of item plus
 * shipping, rounded half-up to a minor unit. Fails with `missing_rate` or `amount_out_of_range`.
 */
export const importTax = (
  item: Money,
  shipping: Amount,
  rule: ImportTaxRule,
  rates: FxTable,
): Result<Amount, PricingError> => {
  const shippingInItemCurrency = convert(shipping, item.currency, rates);
  if (!shippingInItemCurrency.ok) {
    return err(shippingInItemCurrency.error);
  }
  const taxable = toAmount(item.amountMinor + shippingInItemCurrency.value.amountMinor, item.currency);
  if (!taxable.ok) {
    return err(taxable.error);
  }
  const basis = rule.thresholdBasis === ThresholdBasis.Item ? item : taxable.value;
  const basisInThresholdCurrency = convertExact(basis, rule.dutyFreeThreshold.currency, rates);
  if (!basisInThresholdCurrency.ok) {
    return err(basisInThresholdCurrency.error);
  }
  const exempt = basisInThresholdCurrency.value <= rule.dutyFreeThreshold.amountMinor;
  const vat = roundMinor((taxable.value.amountMinor * rule.vatBasisPoints) / BASIS_POINTS_PER_UNIT);
  return toAmount(exempt ? 0 : vat, item.currency);
};
