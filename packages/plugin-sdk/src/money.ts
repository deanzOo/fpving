import { z } from "zod";
import { currencyCodeSchema } from "./iso.js";

/**
 * A price in a currency's minor units, never a float. {@link CURRENCY_MINOR_UNITS} gives the decimal places per
 * currency: USD 19.99 is `1999`, JPY 1999 is `1999`, KWD 1.999 is `1999`. The amount must be a positive safe integer:
 * a price of zero is a store placeholder, not a real offer, and is rejected.
 */
export const moneySchema = z.object({
  amountMinor: z.int().positive(),
  currency: currencyCodeSchema,
});

/** A price as {@link moneySchema} accepts it. */
export type Money = z.infer<typeof moneySchema>;

/** Like {@link moneySchema}, but zero is allowed because free shipping is a real offer. */
export const shippingCostSchema = moneySchema.extend({ amountMinor: z.int().nonnegative() });
