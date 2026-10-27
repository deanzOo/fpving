/** Mints unique entity ids, so tests can make them deterministic. Parse the result with the matching id schema. */
export interface IdGenerator {
  /** A new id, never returned before. */
  next(): string;
}
