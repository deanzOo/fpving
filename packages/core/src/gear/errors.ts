/**
 * Why adding or editing gear stored nothing. `invalid_specs`: the item's specs, or its other fields, break the gear
 * vocabulary of its kind.
 */
export const GearErrorKind = {
  InvalidSpecs: "invalid_specs",
} as const;

/** One of the {@link GearErrorKind} values. */
export type GearErrorKind = (typeof GearErrorKind)[keyof typeof GearErrorKind];
