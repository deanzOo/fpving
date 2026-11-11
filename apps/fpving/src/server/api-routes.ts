import {
  alertIdSchema,
  gearItemIdSchema,
  gearItemSchema,
  listingIdSchema,
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
  TREND_DAYS,
} from "@fpving/core";
import {
  catalogManifestSchema,
  GearKind,
  gearSpecsSchema,
  manifestSchema,
  moneySchema,
  storeErrorSchema,
} from "@fpving/plugin-sdk";
import { z } from "zod";
import { PluginIssueKind, PluginStatusKind } from "../plugins/status.js";
import { apiErrorSchema } from "./errors.js";
import { HttpStatus } from "./http-status.js";

const countSchema = z.int().nonnegative();
const urlBodySchema = z.object({ url: z.string().min(1) });
const productParams = z.object({ productId: productIdSchema });
const listingParams = z.object({ productId: productIdSchema, listingId: listingIdSchema });
const candidateParams = z.object({ candidateId: matchCandidateIdSchema });
const alertParams = z.object({ alertId: alertIdSchema });
const addedListingSchema = z.object({ listing: listingSchema, snapshot: priceSnapshotSchema });

const gearParams = z.object({ gearId: gearItemIdSchema });
const { kind: gearKind, catalogRef, specs: gearSpecs } = gearItemSchema.shape;
const gearDraftSchema = z.object({
  kind: gearKind,
  name: z.string(),
  quantity: z.int(),
  catalogRef,
  specs: gearSpecs,
});
const catalogRefSchema = z.object({ pluginId: pluginIdSchema, key: z.string().min(1) });
const catalogMatchSchema = z.object({
  name: z.string(),
  kind: gearKind,
  specs: z.record(z.string(), z.array(z.object({ value: z.json(), pluginId: pluginIdSchema })).readonly()),
  refs: z.array(catalogRefSchema).readonly(),
});
const gearWithChangesSchema = z.object({
  item: gearItemSchema,
  changes: z.array(z.object({ field: z.string(), saved: z.json(), catalog: z.json() })),
});

const productDetailSchema = z.object({
  product: productSchema,
  listings: z.array(z.object({
    listing: listingSchema,
    history: z.array(priceSnapshotSchema.extend({ landedCost: moneySchema.nullable() })).min(1),
  })),
});

const watchlistSchema = z.array(z.object({
  product: productSchema,
  cheapest: z.object({ listingId: listingIdSchema, landedCost: moneySchema }).nullable(),
  trend: z.array(moneySchema.nullable()).length(TREND_DAYS),
  unreadAlerts: countSchema,
}));

const pluginRowSchema = z.object({
  source: z.string().min(1),
  manifest: z.union([manifestSchema, catalogManifestSchema]).nullable(),
  status: z.enum(PluginStatusKind),
  issues: z.array(z.object({ kind: z.enum(PluginIssueKind), detail: z.string() })),
  backoffUntil: z.date().nullable(),
  staleListings: countSchema,
  unscannedListings: countSchema,
});

/**
 * One row of the plugins screen: a `plugins.json` entry, a rejected entry, the unusable file itself, or the listings
 * of a plugin id nothing in `plugins.json` provides.
 */
export type PluginRow = z.infer<typeof pluginRowSchema>;

const scanStatusSchema = z.object({
  running: z.boolean(),
  latestRun: scanRunSchema.nullable(),
  lastResult: z.object({
    finishedAt: z.date(),
    plugins: z.array(z.object({ run: scanRunSchema, succeeded: countSchema, failed: countSchema })),
    alerts: countSchema,
    transitions: countSchema,
  }).nullable(),
});

/**
 * Whether a scan is running, scheduled or on demand, the newest recorded run and what the last scan that finished
 * since the schedule last started did.
 */
export type ScanStatus = z.infer<typeof scanStatusSchema>;

const { Ok, Created, Accepted, NoContent, NotFound, Conflict, UnprocessableContent, BadGateway, ServiceUnavailable }
  = HttpStatus;
const addErrors = {
  [HttpStatus.BadRequest]: apiErrorSchema,
  [UnprocessableContent]: apiErrorSchema,
  [Conflict]: apiErrorSchema,
  [BadGateway]: apiErrorSchema,
  [ServiceUnavailable]: apiErrorSchema,
};

/**
 * Every domain route: method, path, a one-line summary and the Zod schemas of its request and of each answer. The
 * routes are registered from this table and the API reference page is generated from it.
 */
export const apiRoutes = {
  listProducts: {
    method: "GET",
    url: "/api/products",
    summary: "The watched products, newest first, each with its cheapest landed price in the display currency, "
      + `that price once a day over the last ${String(TREND_DAYS)} days and its unread alert count.`,
    schema: { response: { [Ok]: watchlistSchema } },
  },
  getProduct: {
    method: "GET",
    url: "/api/products/:productId",
    summary: "A product with its listings and each listing's price history, oldest first, each snapshot with its "
      + "landed cost in the display currency or null when it cannot be priced; 404 once archived.",
    schema: { params: productParams, response: { [Ok]: productDetailSchema, [NotFound]: apiErrorSchema } },
  },
  renameProduct: {
    method: "PATCH",
    url: "/api/products/:productId",
    summary: "Renames a product; the name is the only field a product has to edit.",
    schema: {
      params: productParams,
      body: z.object({ name: productSchema.shape.name }),
      response: { [NoContent]: z.null(), [NotFound]: apiErrorSchema },
    },
  },
  archiveProduct: {
    method: "DELETE",
    url: "/api/products/:productId",
    summary: "Stops watching a product. It is archived, keeping its history, and answers 404 everywhere afterwards.",
    schema: { params: productParams, response: { [NoContent]: z.null(), [NotFound]: apiErrorSchema } },
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
  removeListing: {
    method: "DELETE",
    url: "/api/products/:productId/listings/:listingId",
    summary: "Removes a listing from its product: never scanned again and left out of prices, keeping its history.",
    schema: { params: listingParams, response: { [NoContent]: z.null(), [NotFound]: apiErrorSchema } },
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
        [NotFound]: apiErrorSchema, [Conflict]: apiErrorSchema, [ServiceUnavailable]: apiErrorSchema,
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
    schema: { body: settingsSchema, response: { [Ok]: settingsSchema, [ServiceUnavailable]: apiErrorSchema } },
  },
  listPlugins: {
    method: "GET",
    url: "/api/plugins",
    summary: "Every plugin with its status, backoff, stale and not scanned listing counts, "
      + "rejected `plugins.json` entries, an unusable `plugins.json` and listings of plugin ids it does not provide.",
    schema: { response: { [Ok]: z.array(pluginRowSchema) } },
  },
  startScan: {
    method: "POST",
    url: "/api/scan",
    summary: "Starts a scan of every listing in the background; 409 while any scan runs, 503 once shutdown started.",
    schema: {
      response: { [Accepted]: scanStatusSchema, [Conflict]: apiErrorSchema, [ServiceUnavailable]: apiErrorSchema },
    },
  },
  listGear: {
    method: "GET",
    url: "/api/gear",
    summary: "The gear the user owns, by kind then name, each item with the catalog-sourced fields its catalog now "
      + "says differently.",
    schema: { response: { [Ok]: z.array(gearWithChangesSchema) } },
  },
  addGear: {
    method: "POST",
    url: "/api/gear",
    summary: "Stores a gear item. A spec is kept as catalog-sourced only when the item's catalog entry confirms "
      + "its value; every other spec is stored as confirmed by the user.",
    schema: {
      body: gearDraftSchema,
      response: {
        [Created]: gearItemSchema,
        [UnprocessableContent]: apiErrorSchema,
        [ServiceUnavailable]: apiErrorSchema,
      },
    },
  },
  updateGear: {
    method: "PATCH",
    url: "/api/gear/:gearId",
    summary: "Replaces a gear item with the draft, keeping its id and creation time; specs are sourced as when adding.",
    schema: {
      params: gearParams,
      body: gearDraftSchema,
      response: {
        [Ok]: gearItemSchema,
        [NotFound]: apiErrorSchema,
        [UnprocessableContent]: apiErrorSchema,
        [ServiceUnavailable]: apiErrorSchema,
      },
    },
  },
  removeGear: {
    method: "DELETE",
    url: "/api/gear/:gearId",
    summary: "Deletes a gear item.",
    schema: { params: gearParams, response: { [NoContent]: z.null(), [NotFound]: apiErrorSchema } },
  },
  searchCatalog: {
    method: "GET",
    url: "/api/catalog/search",
    summary: "Searches every loaded catalog plugin for gear by name and merges the same item across catalogs. "
      + "A field two catalogs give differently keeps both values. `failedPlugins` lists the catalogs that could not "
      + "answer, `catalogs` how many are loaded.",
    schema: {
      querystring: z.object({ q: z.string().min(1) }),
      response: {
        [Ok]: z.object({
          matches: z.array(catalogMatchSchema),
          failedPlugins: z.array(pluginIdSchema),
          catalogs: countSchema,
        }),
        [ServiceUnavailable]: apiErrorSchema,
      },
    },
  },
  readSpecs: {
    method: "POST",
    url: "/api/gear/read",
    summary: "Reads the name and specs of a piece of gear from pasted text with the AI. Nothing is stored. 503 "
      + "`unavailable` without an API key or when the AI cannot be reached, 502 `malformed_output` when its answer "
      + "fails validation.",
    schema: {
      body: z.object({ kind: z.enum(GearKind), text: z.string().min(1) }),
      response: {
        [Ok]: z.object({ name: z.string().nullable(), specs: gearSpecsSchema }),
        [BadGateway]: apiErrorSchema,
        [ServiceUnavailable]: apiErrorSchema,
      },
    },
  },
  getScan: {
    method: "GET",
    url: "/api/scan",
    summary: "Whether any scan is running, the newest recorded run and the last finished scan's result.",
    schema: { response: { [Ok]: scanStatusSchema } },
  },
} as const;
