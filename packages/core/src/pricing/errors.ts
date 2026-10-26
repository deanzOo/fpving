/**
 * Why a pricing computation failed. `missing_rate`: a conversion needed a currency the rate table has no usable rate
 * for. `amount_out_of_range`: the result is not a safe integer of minor units. `shipping_unknown`: the listing's
 * shipping cost to the destination is unknown, so no landed cost exists.
 */
export const PricingErrorKind = {
  MissingRate: "missing_rate",
  AmountOutOfRange: "amount_out_of_range",
  ShippingUnknown: "shipping_unknown",
} as const;

/** One of the {@link PricingErrorKind} values. */
export type PricingErrorKind = (typeof PricingErrorKind)[keyof typeof PricingErrorKind];
