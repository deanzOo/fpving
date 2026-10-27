import { ShippingKind } from "@fpving/plugin-sdk";
import type { Amount, CurrencyCode, Money, Result, Shipping } from "@fpving/plugin-sdk";
import { err } from "@fpving/plugin-sdk";
import { PricingErrorKind } from "./errors.js";
import { convert, convertExact } from "./fx.js";
import type { FxTable, PricingError } from "./fx.js";
import { toAmount } from "./money.js";
import { importTax } from "./import-tax.js";
import type { ImportTaxRule } from "./import-tax.js";

/** The user's pricing choices: the currency prices are shown in and the import tax rule of the destination. */
export interface PricingSettings {
  displayCurrency: CurrencyCode;
  importTax: ImportTaxRule;
}

/** A landed cost cannot be computed because the listing's shipping cost to the destination is unknown. */
export interface ShippingUnknownError {
  kind: typeof PricingErrorKind.ShippingUnknown;
}

const landedTotal = (
  listing: { itemPrice: Money; shipping: Shipping },
  settings: PricingSettings,
  rates: FxTable,
): Result<Amount, PricingError | ShippingUnknownError> => {
  if (listing.shipping.kind === ShippingKind.Unknown) {
    return err({ kind: PricingErrorKind.ShippingUnknown });
  }
  const { itemPrice } = listing;
  const quoted = { amountMinor: listing.shipping.amountMinor, currency: listing.shipping.currency };
  const shipping = convert(quoted, itemPrice.currency, rates);
  if (!shipping.ok) {
    return err(shipping.error);
  }
  const tax = importTax(itemPrice, shipping.value, settings.importTax, rates);
  if (!tax.ok) {
    return err(tax.error);
  }
  const sum = itemPrice.amountMinor + shipping.value.amountMinor + tax.value.amountMinor;
  return toAmount(sum, itemPrice.currency);
};

/**
 * The true cost of a listing delivered to the user: item plus shipping plus import tax, in the display currency.
 * Unknown shipping is never treated as free and yields `shipping_unknown`. Rounding happens in three places, each
 * half-up to a minor unit: shipping converted into the item's currency, the VAT computed there with
 * {@link importTax}, and one final conversion of the summed total into the display currency.
 */
export const landedCost = (
  listing: { itemPrice: Money; shipping: Shipping },
  settings: PricingSettings,
  rates: FxTable,
): Result<Amount, PricingError | ShippingUnknownError> => {
  const total = landedTotal(listing, settings, rates);
  return total.ok ? convert(total.value, settings.displayCurrency, rates) : total;
};

/**
 * The same cost as {@link landedCost} but the final conversion into the display currency is left unrounded, in
 * fractional minor units of that currency, so costs from different currencies can be compared without rounding
 * ties. Shipping and VAT are still rounded in the item's currency first.
 */
export const landedCostExact = (
  listing: { itemPrice: Money; shipping: Shipping },
  settings: PricingSettings,
  rates: FxTable,
): Result<number, PricingError | ShippingUnknownError> => {
  const total = landedTotal(listing, settings, rates);
  return total.ok ? convertExact(total.value, settings.displayCurrency, rates) : total;
};
