/** Doubles a number. */
export function double(value: number): number {
  return value + value;
}

/** Triples a number. */
export const triple = (value: number): number => value * value;

/** A pair of numbers. */
export type Pair = readonly [number, number];

/** Something with a name. */
export interface Named {
  readonly name: string;
}

/** Counts from a start value. */
export class Counter {
  readonly start = 0;
}

/** Speed modes. */
export const modes = { fast: "fast", slow: "slow" } as const;
