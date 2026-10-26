import { z } from "zod";
import type { Result } from "./result.js";

/**
 * Why a store call failed. Plugins return these as {@link Result} errors and never throw for them.
 *
 * @remarks
 * - `not_found`: the product page is gone (HTTP 404 or a "no longer available" page).
 * - `blocked`: the store refused the request, for example a captcha or bot wall.
 * - `parse_failed`: the page loaded but the plugin could not read it; attach the page as `rawPage`.
 * - `timeout`: the host HTTP client or browser timed out.
 * - `network`: any other transport failure.
 * - `unsupported_ship_to`: the store does not ship to the context's `shipTo` country.
 */
export const StoreErrorKind = {
  NotFound: "not_found",
  Blocked: "blocked",
  ParseFailed: "parse_failed",
  Timeout: "timeout",
  Network: "network",
  UnsupportedShipTo: "unsupported_ship_to",
} as const;

/** One of the {@link StoreErrorKind} values. */
export type StoreErrorKind = (typeof StoreErrorKind)[keyof typeof StoreErrorKind];

const { ParseFailed, ...otherKinds } = StoreErrorKind;

/**
 * Validates a store error. It is a union on `kind` so that `rawPage` exists only on `parse_failed`, where the host
 * saves it as a ready-made test fixture; a `rawPage` sent with any other kind is dropped.
 */
export const storeErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(ParseFailed), detail: z.string(), rawPage: z.string().optional() }),
  z.object({ kind: z.enum(otherKinds), detail: z.string() }),
]);

/** A store error as {@link storeErrorSchema} accepts it. `detail` is a human-readable reason for logs. */
export type StoreError = z.infer<typeof storeErrorSchema>;

/** What every {@link Store} method resolves to: a value or a {@link StoreError}. */
export type StoreResult<T> = Result<T, StoreError>;
