import { ShippingKind } from "@fpving/plugin-sdk";
import type { Amount, CurrencyCode, Money, Result, Shipping } from "@fpving/plugin-sdk";
import { err } from "@fpving/plugin-sdk";
import { convert } from "./fx.js";
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
export interface ShippingUnknown {
  kind: "shipping_unknown";
}

/**
 * The true cost of a listing delivered to the user: item plus shipping plus import tax, in the display currency.
 * Unknown shipping is never treated as free and yields `shipping_unknown`. Shipping is converted into the item's
 * currency, tax is computed there with {@link importTax}, the three are summed and the total is converted to the
 * display currency once, so the parts are never rounded separately.
 */
export const landedCost = (
  listing: { itemPrice: Money; shipping: Shipping },
  settings: PricingSettings,
  rates: FxTable,
): Result<Amount, PricingError | ShippingUnknown> => {
  if (listing.shipping.kind === ShippingKind.Unknown) {
    return err({ kind: "shipping_unknown" });
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
  const total = toAmount(sum, itemPrice.currency);
  return total.ok ? convert(total.value, settings.displayCurrency, rates) : err(total.error);
};
