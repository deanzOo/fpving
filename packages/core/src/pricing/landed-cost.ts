import { ShippingKind } from "@fpving/plugin-sdk";
import type { CurrencyCode, Money, Result, Shipping } from "@fpving/plugin-sdk";
import { err, ok } from "@fpving/plugin-sdk";
import { convert } from "./fx.js";
import type { FxTable, MissingRate } from "./fx.js";
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
 * Unknown shipping is never treated as free and yields `shipping_unknown`. Tax comes from {@link importTax} in
 * the item's currency, then all three parts are converted to the display currency and summed.
 */
export const landedCost = (
  listing: { itemPrice: Money; shipping: Shipping },
  settings: PricingSettings,
  rates: FxTable,
): Result<Money, MissingRate | ShippingUnknown> => {
  if (listing.shipping.kind === ShippingKind.Unknown) {
    return err({ kind: "shipping_unknown" });
  }
  const { itemPrice } = listing;
  const shipping = { amountMinor: listing.shipping.amountMinor, currency: listing.shipping.currency };
  const tax = importTax(itemPrice, shipping, settings.importTax, rates);
  if (!tax.ok) {
    return err(tax.error);
  }
  let amountMinor = 0;
  for (const part of [itemPrice, shipping, tax.value]) {
    const converted = convert(part, settings.displayCurrency, rates);
    if (!converted.ok) {
      return err(converted.error);
    }
    amountMinor += converted.value.amountMinor;
  }
  return ok({ amountMinor, currency: settings.displayCurrency });
};
