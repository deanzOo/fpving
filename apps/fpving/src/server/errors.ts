import { AddErrorKind, MatchErrorKind } from "@fpving/core";
import { z } from "zod";

/**
 * Every kind an error reply names. The shell's own refusals, then the domain refusals, which reuse core's error kind
 * values where core has one.
 */
export const ApiErrorKind = {
  MisdirectedRequest: "misdirected_request",
  CrossOrigin: "cross_origin",
  Starting: "starting",
  InvalidRequest: "invalid_request",
  RequestRefused: "request_refused",
  Internal: "internal",
  NotFound: "not_found",
  ...AddErrorKind,
  ...MatchErrorKind,
  AlertNotFound: "alert_not_found",
  ListingNotFound: "listing_not_found",
  PluginUnavailable: "plugin_unavailable",
  ScanRunning: "scan_running",
  Restarting: "restarting",
} as const;

/** One of the {@link ApiErrorKind} values. */
export type ApiErrorKind = (typeof ApiErrorKind)[keyof typeof ApiErrorKind];

/** The one shape of every error reply: `{ error: { kind, message } }`. */
export const apiErrorSchema = z.object({
  error: z.object({ kind: z.enum(ApiErrorKind), message: z.string().min(1) }),
});

/** An error reply as {@link apiErrorSchema} accepts it. */
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Builds an error reply.
 *
 * @param kind - What went wrong.
 * @param message - One line for the user; never internal detail.
 * @returns The reply body.
 */
export const apiError = (kind: ApiErrorKind, message: string): ApiError => ({ error: { kind, message } });
