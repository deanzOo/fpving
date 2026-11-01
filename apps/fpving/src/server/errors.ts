import { AddErrorKind, MatchErrorKind, productSchema } from "@fpving/core";
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
  ShuttingDown: "shutting_down",
  SettingsNotApplied: "settings_not_applied",
} as const;

/** One of the {@link ApiErrorKind} values. */
export type ApiErrorKind = (typeof ApiErrorKind)[keyof typeof ApiErrorKind];

const messageSchema = z.string().min(1);

const { AlreadyTracked, ...PlainKinds } = ApiErrorKind;

const plainErrorKindSchema = z.enum(PlainKinds);

/** Any error kind but `already_tracked`, whose reply also names the product. */
export type PlainErrorKind = z.infer<typeof plainErrorKindSchema>;

/**
 * The one shape of every error reply: `{ error: { kind, message } }`, where `already_tracked` also carries the id and
 * name of the product that tracks the URL.
 */
export const apiErrorSchema = z.object({
  error: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal(AlreadyTracked),
      message: messageSchema,
      product: productSchema.pick({ id: true, name: true }),
    }),
    z.object({ kind: plainErrorKindSchema, message: messageSchema }),
  ]),
});

/** An error reply as {@link apiErrorSchema} accepts it. */
export type ApiError = z.infer<typeof apiErrorSchema>;

/** The product an `already_tracked` reply names. */
export type TrackedProduct = Extract<ApiError["error"], { product: unknown }>["product"];

/**
 * Builds an error reply.
 *
 * @param kind - What went wrong.
 * @param message - One line for the user; never internal detail.
 * @returns The reply body.
 */
export const apiError = (kind: PlainErrorKind, message: string): ApiError => ({ error: { kind, message } });

/**
 * Builds the `already_tracked` reply.
 *
 * @param product - The product that tracks the URL.
 * @param message - One line for the user.
 * @returns The reply body.
 */
export const alreadyTrackedError = (product: TrackedProduct, message: string): ApiError => ({
  error: { kind: ApiErrorKind.AlreadyTracked, message, product },
});
