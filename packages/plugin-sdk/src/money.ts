import { z } from "zod";
import { currencyCodeSchema } from "./iso.js";

/**
 * A computed or quoted sum of money in a currency's minor units: a non-negative safe integer, so zero is allowed.
 * Free shipping and an exempt import tax are real zero amounts. {@link CURRENCY_MINOR_UNITS} gives the decimal
 * places per currency.
 */
export const amountSchema = z.object({
  amountMinor: z.int().nonnegative(),
  currency: currencyCodeSchema,
});

/** An amount as {@link amountSchema} accepts it. */
export type Amount = z.infer<typeof amountSchema>;

/**
 * A price in a currency's minor units, never a float. {@link CURRENCY_MINOR_UNITS} gives the decimal places per
 * currency: USD 19.99 is `1999`, JPY 1999 is `1999`, KWD 1.999 is `1999`. Unlike an {@link amountSchema} amount it
 * must be positive: a price of zero is a store placeholder, not a real offer, and is rejected.
 */
export const moneySchema = amountSchema.extend({ amountMinor: z.int().positive() });

/** A price as {@link moneySchema} accepts it. */
export type Money = z.infer<typeof moneySchema>;
