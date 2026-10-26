/** Doubles a number. */
export function double(value: number): number {
  return value + value;
}

/** Squares a number. */
export const square = (value: number): number => value * value;

/** A pair of numbers. */
export type Pair = readonly [number, number];

/** Something with a name. */
export interface Named {
  /** The display name. */
  readonly name: string;
}

/** Counts from a start value. */
export class Counter {
  readonly start = 0;
}

/** Speed modes. */
export const modes = { fast: "fast", slow: "slow" } as const;
