import {
  AlertKind,
  CandidateStatus,
  ListingOrigin,
  ListingStatus,
  LlmVerdict,
  ScanOutcome,
  ThresholdBasis,
  verdictSchema,
} from "@fpving/core";
import { ShippingKind, StoreErrorKind } from "@fpving/plugin-sdk";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const SETTINGS_ROW_ID = 1;
const restrict = { onDelete: "restrict" } as const;

const literal = (value: string | number): SQL => sql.raw(typeof value === "string" ? `'${value}'` : String(value));

const oneOf = (column: AnySQLiteColumn, values: Record<string, string>): SQL =>
  sql`${column} in (${sql.join(Object.values(values).map(literal), sql`, `)})`;

const nullExactlyWhen = (column: AnySQLiteColumn, condition: SQL): SQL => sql`(${condition}) = (${column} is null)`;

const instant = (name: string) => integer(name, { mode: "timestamp_ms" });

export const products = sqliteTable("products", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: instant("created_at").notNull(),
  archivedAt: instant("archived_at"),
  cheapestListingId: text("cheapest_listing_id").references((): AnySQLiteColumn => listings.id, restrict),
});

export const listings = sqliteTable("listings", {
  id: text().primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, restrict),
  pluginId: text("plugin_id").notNull(),
  url: text().notNull().unique(),
  title: text().notNull(),
  status: text().notNull(),
  origin: text().notNull(),
  addedAt: instant("added_at").notNull(),
  failureStreak: integer("failure_streak").notNull(),
  notFoundStreak: integer("not_found_streak").notNull(),
}, (table) => [
  index("listings_product_id_idx").on(table.productId),
  index("listings_plugin_id_status_idx").on(table.pluginId, table.status),
  check("listings_status_check", oneOf(table.status, ListingStatus)),
  check("listings_origin_check", oneOf(table.origin, ListingOrigin)),
]);

export const priceSnapshots = sqliteTable("price_snapshots", {
  id: text().primaryKey(),
  listingId: text("listing_id").notNull().references(() => listings.id, restrict),
  observedAt: instant("observed_at").notNull(),
  shipTo: text("ship_to").notNull(),
  itemAmountMinor: integer("item_amount_minor").notNull(),
  itemCurrency: text("item_currency").notNull(),
  shippingKind: text("shipping_kind").notNull(),
  shippingAmountMinor: integer("shipping_amount_minor"),
  shippingCurrency: text("shipping_currency"),
  inStock: integer("in_stock", { mode: "boolean" }).notNull(),
}, (table) => {
  const unknownShipping = sql`${table.shippingKind} = ${literal(ShippingKind.Unknown)}`;
  return [
    index("price_snapshots_listing_id_observed_at_idx").on(table.listingId, table.observedAt),
    check("price_snapshots_shipping_kind_check", oneOf(table.shippingKind, ShippingKind)),
    check(
      "price_snapshots_shipping_check",
      sql`${nullExactlyWhen(table.shippingAmountMinor, unknownShipping)} and ${
        nullExactlyWhen(table.shippingCurrency, unknownShipping)
      }`,
    ),
  ];
});

export const matchCandidates = sqliteTable("match_candidates", {
  id: text().primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, restrict),
  pluginId: text("plugin_id").notNull(),
  url: text().notNull(),
  title: text().notNull(),
  similarity: real().notNull(),
  llmVerdict: text("llm_verdict").notNull(),
  llmReason: text("llm_reason"),
  status: text().notNull(),
}, (table) => [
  unique("match_candidates_product_id_url_unique").on(table.productId, table.url),
  index("match_candidates_status_idx").on(table.status),
  check("match_candidates_llm_verdict_check", oneOf(table.llmVerdict, LlmVerdict)),
  check("match_candidates_status_check", oneOf(table.status, CandidateStatus)),
  check(
    "match_candidates_llm_reason_check",
    nullExactlyWhen(table.llmReason, sql`${table.llmVerdict} = ${literal(LlmVerdict.Unjudged)}`),
  ),
]);

export const verdictCache = sqliteTable("verdict_cache", {
  sourceUrl: text("source_url").notNull(),
  candidateUrl: text("candidate_url").notNull(),
  verdict: text().notNull(),
  reason: text().notNull(),
  judgedAt: instant("judged_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.sourceUrl, table.candidateUrl] }),
  check("verdict_cache_verdict_check", oneOf(table.verdict, verdictSchema.shape.verdict.enum)),
]);

export const alerts = sqliteTable("alerts", {
  id: text().primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, restrict),
  listingId: text("listing_id").notNull().references(() => listings.id, restrict),
  kind: text().notNull(),
  beforeSnapshotId: text("before_snapshot_id").references(() => priceSnapshots.id, restrict),
  afterSnapshotId: text("after_snapshot_id").notNull().references(() => priceSnapshots.id, restrict),
  createdAt: instant("created_at").notNull(),
  readAt: instant("read_at"),
}, (table) => [
  index("alerts_read_at_created_at_idx").on(table.readAt, table.createdAt),
  check("alerts_kind_check", oneOf(table.kind, AlertKind)),
]);

export const scanRuns = sqliteTable("scan_runs", {
  id: text().primaryKey(),
  pluginId: text("plugin_id").notNull(),
  startedAt: instant("started_at").notNull(),
  finishedAt: instant("finished_at").notNull(),
  outcome: text().notNull(),
  errorKind: text("error_kind"),
}, (table) => [
  index("scan_runs_plugin_id_started_at_idx").on(table.pluginId, table.startedAt),
  check("scan_runs_outcome_check", oneOf(table.outcome, ScanOutcome)),
  check("scan_runs_error_kind_check", oneOf(table.errorKind, StoreErrorKind)),
  check(
    "scan_runs_error_kind_null_check",
    nullExactlyWhen(table.errorKind, sql`${table.outcome} = ${literal(ScanOutcome.Ok)}`),
  ),
]);

export const pluginHealth = sqliteTable("plugin_health", {
  pluginId: text("plugin_id").primaryKey(),
  consecutiveBlocks: integer("consecutive_blocks").notNull(),
  backoffUntil: instant("backoff_until"),
});

export const fxTables = sqliteTable("fx_tables", {
  id: integer().primaryKey({ autoIncrement: true }),
  base: text().notNull(),
  ratesJson: text("rates_json", { mode: "json" }).notNull(),
  fetchedOn: text("fetched_on").notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer().primaryKey(),
  displayCurrency: text("display_currency").notNull(),
  shipToCountry: text("ship_to_country").notNull(),
  dutyFreeAmountMinor: integer("duty_free_amount_minor").notNull(),
  dutyFreeCurrency: text("duty_free_currency").notNull(),
  vatBasisPoints: integer("vat_basis_points").notNull(),
  thresholdBasis: text("threshold_basis").notNull(),
  scanIntervalHours: integer("scan_interval_hours").notNull(),
  priceDropMinBasisPoints: integer("price_drop_min_basis_points").notNull(),
}, (table) => [
  check("settings_singleton_check", sql`${table.id} = ${literal(SETTINGS_ROW_ID)}`),
  check("settings_threshold_basis_check", oneOf(table.thresholdBasis, ThresholdBasis)),
]);
