import { err, StoreErrorKind } from "@fpving/plugin-sdk";
import type { Result, TransportError } from "@fpving/plugin-sdk";

/**
 * Builds the failed result both transports return.
 *
 * @param timedOut - Whether the failure was the host's own deadline.
 * @param error - What was thrown, kept as text for the log.
 * @returns A `timeout` or `network` {@link TransportError}.
 */
export const transportFailure = (timedOut: boolean, error: unknown): Result<never, TransportError> =>
  err({ kind: timedOut ? StoreErrorKind.Timeout : StoreErrorKind.Network, detail: String(error) });
