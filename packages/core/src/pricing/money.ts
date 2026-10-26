const HALF = 0.5;

/**
 * Rounds a fractional amount of minor units half-up: a tie goes to the larger value. Every pricing conversion
 * rounds through this one helper, and amounts here are never negative, so half-up is also half away from zero.
 */
export const roundMinor = (amountMinor: number): number => Math.floor(amountMinor + HALF);
