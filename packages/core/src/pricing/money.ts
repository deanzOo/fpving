import { err, ok } from "@fpving/plugin-sdk";
import type { Amount, CurrencyCode, Result } from "@fpving/plugin-sdk";
import { PricingErrorKind } from "./errors.js";

const HALF = 0.5;

/** A computed amount is not a safe integer of minor units, so it cannot be represented exactly. */
export interface AmountOutOfRange {
  kind: typeof PricingErrorKind.AmountOutOfRange;
}

/**
 * Rounds a fractional amount of minor units half-up: a tie goes to the larger value. Every pricing conversion
 * rounds through this one helper, and amounts here are never negative, so half-up is also half away from zero.
 */
export const roundMinor = (amountMinor: number): number => Math.floor(amountMinor + HALF);

/** Wraps minor units as an {@link Amount}, or reports `amount_out_of_range` when they are not a safe integer. */
export const toAmount = (amountMinor: number, currency: CurrencyCode): Result<Amount, AmountOutOfRange> =>
  Number.isSafeInteger(amountMinor) ? ok({ amountMinor, currency }) : err({ kind: PricingErrorKind.AmountOutOfRange });
