import {
  countryCodeSchema,
  currencyCodeSchema,
  httpUrlSchema,
  moneySchema,
  shippingSchema,
  StoreErrorKind,
} from "@fpving/plugin-sdk";
import { z } from "zod";
import {
  alertIdSchema,
  listingIdSchema,
  matchCandidateIdSchema,
  pluginIdSchema,
  productIdSchema,
  scanRunIdSchema,
  snapshotIdSchema,
} from "./ids.js";
import { COUNTRY_PRESETS } from "./pricing/country-presets.js";
import { importTaxRuleSchema } from "./pricing/import-tax.js";
import { textSchema } from "./text.js";

const countSchema = z.int().nonnegative();

/**
 * How a listing is doing. `stale` after repeated failed fetches, shown with its last good price; `gone` once the
 * store reported the page missing twice.
 */
export const ListingStatus = { Active: "active", Stale: "stale", Gone: "gone" } as const;

/** One of the {@link ListingStatus} values. */
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];

/** How a listing joined its product: pasted by the user, or accepted from a match candidate. */
export const ListingOrigin = { Manual: "manual", Matched: "matched" } as const;

/** One of the {@link ListingOrigin} values. */
export type ListingOrigin = (typeof ListingOrigin)[keyof typeof ListingOrigin];

/**
 * The LLM's judgement of a candidate against the product: the same item, a variant of it, a different item, or
 * `unjudged` when the LLM was unavailable or answered malformed output.
 */
export const LlmVerdict = { Same: "same", Variant: "variant", Different: "different", Unjudged: "unjudged" } as const;

/** One of the {@link LlmVerdict} values. */
export type LlmVerdict = (typeof LlmVerdict)[keyof typeof LlmVerdict];

/** Where a match candidate is in the review queue. */
export const CandidateStatus = { Pending: "pending", Accepted: "accepted", Rejected: "rejected" } as const;

/** One of the {@link CandidateStatus} values. */
export type CandidateStatus = (typeof CandidateStatus)[keyof typeof CandidateStatus];

/** What an alert reports. */
export const AlertKind = {
  PriceDrop: "price_drop",
  BackInStock: "back_in_stock",
  NewCheapest: "new_cheapest",
} as const;

/** One of the {@link AlertKind} values. */
export type AlertKind = (typeof AlertKind)[keyof typeof AlertKind];

/** How one plugin's scan ended. */
export const ScanOutcome = { Ok: "ok", Failed: "failed", Blocked: "blocked" } as const;

/** One of the {@link ScanOutcome} values. */
export type ScanOutcome = (typeof ScanOutcome)[keyof typeof ScanOutcome];

/**
 * A watched product. `name` starts as the first listing's title and is editable. `cheapestListingId` is the listing
 * the last alert evaluation found cheapest, null until one was found.
 */
export const productSchema = z.object({
  id: productIdSchema,
  name: textSchema,
  createdAt: z.date(),
  archivedAt: z.date().nullable(),
  cheapestListingId: listingIdSchema.nullable(),
});

/** A product as {@link productSchema} accepts it. */
export type Product = z.infer<typeof productSchema>;

/**
 * One store page of a product, fetched by the plugin `pluginId`. `url` is normalized and unique across all
 * listings. `failureStreak` counts consecutive failed fetches and `notFoundStreak` consecutive `not_found` results.
 */
export const listingSchema = z.object({
  id: listingIdSchema,
  productId: productIdSchema,
  pluginId: pluginIdSchema,
  url: httpUrlSchema,
  title: textSchema,
  status: z.enum(ListingStatus),
  origin: z.enum(ListingOrigin),
  addedAt: z.date(),
  failureStreak: countSchema,
  notFoundStreak: countSchema,
});

/** A listing as {@link listingSchema} accepts it. */
export type Listing = z.infer<typeof listingSchema>;

/**
 * One observation of a listing, append-only. Amounts are store-native and converted only when read; `shipTo` is
 * the destination the price was quoted for, and snapshots for different destinations are never compared.
 */
export const priceSnapshotSchema = z.object({
  id: snapshotIdSchema,
  listingId: listingIdSchema,
  observedAt: z.date(),
  shipTo: countryCodeSchema,
  itemPrice: moneySchema,
  shipping: shippingSchema,
  inStock: z.boolean(),
});

/** A price snapshot as {@link priceSnapshotSchema} accepts it. */
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;

/** A verdict the LLM actually gave, with its one-line reason. */
export const verdictSchema = z.object({
  verdict: z.enum([LlmVerdict.Same, LlmVerdict.Variant, LlmVerdict.Different]),
  reason: textSchema,
});

/** A verdict as {@link verdictSchema} accepts it. */
export type Verdict = z.infer<typeof verdictSchema>;

/**
 * A search result that may be the product, waiting for review. `similarityScore` ranks candidates from 0 to 1;
 * `llmReason` is null exactly while `llmVerdict` is `unjudged`.
 */
export const matchCandidateSchema = z.object({
  id: matchCandidateIdSchema,
  productId: productIdSchema,
  pluginId: pluginIdSchema,
  url: httpUrlSchema,
  title: textSchema,
  similarityScore: z.number().min(0).max(1),
  llmVerdict: z.enum(LlmVerdict),
  llmReason: textSchema.nullable(),
  status: z.enum(CandidateStatus),
}).refine((row) => (row.llmVerdict === LlmVerdict.Unjudged) === (row.llmReason === null), {
  message: "llmReason must be null exactly when llmVerdict is unjudged",
});

/** A match candidate as {@link matchCandidateSchema} accepts it. */
export type MatchCandidate = z.infer<typeof matchCandidateSchema>;

/** A verdict remembered for a source and candidate url pair, so the same pair is never judged twice. */
export const cachedVerdictSchema = verdictSchema.extend({
  sourceUrl: httpUrlSchema,
  candidateUrl: httpUrlSchema,
  judgedAt: z.date(),
});

/** A cached verdict as {@link cachedVerdictSchema} accepts it. */
export type CachedVerdict = z.infer<typeof cachedVerdictSchema>;

/** A raised alert. `beforeSnapshotId` is null when no earlier snapshot applies; `readAt` is null while unread. */
export const alertSchema = z.object({
  id: alertIdSchema,
  productId: productIdSchema,
  listingId: listingIdSchema,
  kind: z.enum(AlertKind),
  beforeSnapshotId: snapshotIdSchema.nullable(),
  afterSnapshotId: snapshotIdSchema,
  createdAt: z.date(),
  readAt: z.date().nullable(),
});

/** An alert as {@link alertSchema} accepts it. */
export type Alert = z.infer<typeof alertSchema>;

/** One plugin's part of a scan. `errorKind` is the store error that ended it, null exactly when it ended `ok`. */
export const scanRunSchema = z.object({
  id: scanRunIdSchema,
  pluginId: pluginIdSchema,
  startedAt: z.date(),
  finishedAt: z.date(),
  outcome: z.enum(ScanOutcome),
  errorKind: z.enum(StoreErrorKind).nullable(),
}).refine((run) => (run.outcome === ScanOutcome.Ok) === (run.errorKind === null), {
  message: "errorKind must be null exactly when the outcome is ok",
});

/** A scan run as {@link scanRunSchema} accepts it. */
export type ScanRun = z.infer<typeof scanRunSchema>;

/**
 * A plugin's backoff state: consecutive `blocked` results, and when it may be called again or null when not backing
 * off.
 */
export const pluginHealthSchema = z.object({
  pluginId: pluginIdSchema,
  consecutiveBlocks: countSchema,
  backoffUntil: z.date().nullable(),
});

/** Plugin health as {@link pluginHealthSchema} accepts it. */
export type PluginHealth = z.infer<typeof pluginHealthSchema>;

/**
 * The user's settings. `priceDropMinBasisPoints` is the smallest drop below the previous 30-day low that raises a
 * price drop alert, in hundredths of a percent, so 500 is 5%.
 */
export const settingsSchema = z.object({
  displayCurrency: currencyCodeSchema,
  shipToCountry: countryCodeSchema,
  importTax: importTaxRuleSchema,
  scanIntervalHours: z.int().positive(),
  priceDropMinBasisPoints: countSchema,
});

/** Settings as {@link settingsSchema} accepts them. */
export type Settings = z.infer<typeof settingsSchema>;

/** `T` with every property readonly, recursively. */
export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };

const { importTax } = COUNTRY_PRESETS.IL;

/**
 * The settings used until the user saves their own: Israel, shown in ILS, scanned every 12 hours, 5% drops. Frozen
 * down to the import tax threshold; copy it before changing anything.
 */
export const DEFAULT_SETTINGS: DeepReadonly<Settings> = Object.freeze({
  displayCurrency: "ILS",
  shipToCountry: "IL",
  importTax: Object.freeze({ ...importTax, dutyFreeThreshold: Object.freeze({ ...importTax.dutyFreeThreshold }) }),
  scanIntervalHours: 12,
  priceDropMinBasisPoints: 500,
});
