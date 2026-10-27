/**
 * Why assisted matching did nothing. `no_source_listing`: the product has no manual listing to match from.
 * `not_pending`: no pending candidate has the id, because it does not exist or was already accepted or rejected.
 */
export const MatchErrorKind = { NoSourceListing: "no_source_listing", NotPending: "not_pending" } as const;

/** One of the {@link MatchErrorKind} values. */
export type MatchErrorKind = (typeof MatchErrorKind)[keyof typeof MatchErrorKind];
