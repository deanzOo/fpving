import {
  alertIdSchema,
  alertSchema,
  listingSchema,
  matchCandidateIdSchema,
  matchCandidateSchema,
  pluginIdSchema,
  priceSnapshotSchema,
  productIdSchema,
  productSchema,
  scanRunSchema,
  settingsSchema,
} from "@fpving/core";
import { manifestSchema, storeErrorSchema } from "@fpving/plugin-sdk";
import { z } from "zod";
import { PluginIssueKind, PluginStatusKind } from "../plugins/status.js";
import { apiErrorSchema } from "./errors.js";

/** The statuses the API routes answer with. */
export const RouteStatus = {
  Ok: 200,
  Created: 201,
  Accepted: 202,
  NoContent: 204,
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
  UnprocessableContent: 422,
  BadGateway: 502,
} as const;

const countSchema = z.int().nonnegative();
const urlBodySchema = z.object({ url: z.string().min(1) });
const productParams = z.object({ productId: productIdSchema });
const candidateParams = z.object({ candidateId: matchCandidateIdSchema });
const alertParams = z.object({ alertId: alertIdSchema });
const addedListingSchema = z.object({ listing: listingSchema, snapshot: priceSnapshotSchema });

/**
 * A product with its listings, oldest first, and each listing's full price history, oldest first, so the last
 * snapshot is the newest. Every listing has at least its first snapshot.
 */
export const productDetailSchema = z.object({
  product: productSchema,
  listings: z.array(z.object({ listing: listingSchema, history: z.array(priceSnapshotSchema).min(1) })),
});

/** One row of the plugins screen: a `plugins.json` entry, a rejected entry or the unusable file itself. */
export const pluginRowSchema = z.object({
  source: z.string().min(1),
  manifest: manifestSchema.nullable(),
  status: z.enum(PluginStatusKind),
  issues: z.array(z.object({ kind: z.enum(PluginIssueKind), detail: z.string() })),
});

/** A plugins screen row as {@link pluginRowSchema} accepts it. */
export type PluginRow = z.infer<typeof pluginRowSchema>;

/** Whether a scan the API started is running, the newest recorded run and what the last finished API scan did. */
export const scanStatusSchema = z.object({
  running: z.boolean(),
  latestRun: scanRunSchema.nullable(),
  lastResult: z.object({
    finishedAt: z.date(),
    plugins: z.array(z.object({ run: scanRunSchema, succeeded: countSchema, failed: countSchema })),
    alerts: countSchema,
    transitions: countSchema,
  }).nullable(),
});

/** A scan status as {@link scanStatusSchema} accepts it. */
export type ScanStatus = z.infer<typeof scanStatusSchema>;

const { Ok, Created, Accepted, NoContent, NotFound, Conflict, UnprocessableContent, BadGateway } = RouteStatus;
const addErrors = {
  [RouteStatus.BadRequest]: apiErrorSchema,
  [UnprocessableContent]: apiErrorSchema,
  [Conflict]: apiErrorSchema,
  [BadGateway]: apiErrorSchema,
};

/**
 * Every domain route: method, path, a one-line summary and the Zod schemas of its request and of each answer. The
 * routes are registered from this table and the API reference page is generated from it.
 */
export const apiRoutes = {
  getProduct: {
    method: "GET",
    url: "/api/products/:productId",
    summary: "A product with its listings and each listing's price history, oldest first.",
    schema: { params: productParams, response: { [Ok]: productDetailSchema, [NotFound]: apiErrorSchema } },
  },
  addProduct: {
    method: "POST",
    url: "/api/products",
    summary: "Starts watching the product behind a pasted store URL.",
    schema: {
      body: urlBodySchema,
      response: { [Created]: addedListingSchema.extend({ product: productSchema }), ...addErrors },
    },
  },
  addListing: {
    method: "POST",
    url: "/api/products/:productId/listings",
    summary: "Adds a pasted store URL to a product as a manual listing.",
    schema: {
      params: productParams,
      body: urlBodySchema,
      response: { [Created]: addedListingSchema, ...addErrors, [NotFound]: apiErrorSchema },
    },
  },
  listCandidates: {
    method: "GET",
    url: "/api/products/:productId/candidates",
    summary: "A product's pending match candidates, most similar first.",
    schema: { params: productParams, response: { [Ok]: z.array(matchCandidateSchema), [NotFound]: apiErrorSchema } },
  },
  findMatches: {
    method: "POST",
    url: "/api/products/:productId/candidates/search",
    summary: "Searches the other stores for a product and saves the likeliest results as pending candidates.",
    schema: {
      params: productParams,
      response: {
        [Ok]: z.object({
          candidates: z.array(matchCandidateSchema),
          failedSearches: z.array(z.object({ pluginId: pluginIdSchema, error: storeErrorSchema })),
          foreignResults: z.array(z.object({ pluginId: pluginIdSchema, count: countSchema })),
        }),
        [NotFound]: apiErrorSchema, [Conflict]: apiErrorSchema,
      },
    },
  },
  acceptCandidate: {
    method: "POST",
    url: "/api/candidates/:candidateId/accept",
    summary: "Accepts a pending candidate, adding it to its product as a matched listing.",
    schema: {
      params: candidateParams,
      response: { [Created]: addedListingSchema, ...addErrors, [NotFound]: apiErrorSchema },
    },
  },
  rejectCandidate: {
    method: "POST",
    url: "/api/candidates/:candidateId/reject",
    summary: "Rejects a pending candidate, so its URL is never suggested for the product again.",
    schema: { params: candidateParams, response: { [NoContent]: z.null(), [NotFound]: apiErrorSchema } },
  },
  listAlerts: {
    method: "GET",
    url: "/api/alerts",
    summary: "Alerts newest first, only unread ones with `unread=true`.",
    schema: {
      querystring: z.object({ unread: z.stringbool().optional() }),
      response: { [Ok]: z.array(alertSchema) },
    },
  },
  markAlertRead: {
    method: "POST",
    url: "/api/alerts/:alertId/read",
    summary: "Marks one alert read.",
    schema: { params: alertParams, response: { [NoContent]: z.null(), [NotFound]: apiErrorSchema } },
  },
  markAllAlertsRead: {
    method: "POST",
    url: "/api/alerts/read",
    summary: "Marks every unread alert read and says how many there were.",
    schema: { response: { [Ok]: z.object({ marked: countSchema }) } },
  },
  getSettings: {
    method: "GET",
    url: "/api/settings",
    summary: "The saved settings, or the defaults before any were saved.",
    schema: { response: { [Ok]: settingsSchema } },
  },
  putSettings: {
    method: "PUT",
    url: "/api/settings",
    summary: "Replaces the settings; a ship-to or currency change restarts the plugins, a new interval the schedule.",
    schema: { body: settingsSchema, response: { [Ok]: settingsSchema } },
  },
  listPlugins: {
    method: "GET",
    url: "/api/plugins",
    summary: "Every plugin with its status, rejected `plugins.json` entries and an unusable `plugins.json`.",
    schema: { response: { [Ok]: z.array(pluginRowSchema) } },
  },
  startScan: {
    method: "POST",
    url: "/api/scan",
    summary: "Starts a scan of every listing in the background; one at a time.",
    schema: { response: { [Accepted]: scanStatusSchema, [Conflict]: apiErrorSchema } },
  },
  getScan: {
    method: "GET",
    url: "/api/scan",
    summary: "Whether a scan the API started is running, the newest recorded run and the last API scan's result.",
    schema: { response: { [Ok]: scanStatusSchema } },
  },
} as const;
