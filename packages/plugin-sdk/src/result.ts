/** Outcome of an operation that can fail: a success value or a typed error, never a thrown exception. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Wraps a value as a successful {@link Result}. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Wraps an error as a failed {@link Result}. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
