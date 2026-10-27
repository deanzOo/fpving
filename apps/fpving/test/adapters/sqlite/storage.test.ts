import { join } from "node:path";
import {
  AlertKind,
  CandidateStatus,
  ListingOrigin,
  ListingStatus,
  LlmVerdict,
  ScanOutcome,
  ThresholdBasis,
  alertIdSchema,
  listingIdSchema,
  matchCandidateIdSchema,
  pluginIdSchema,
  productIdSchema,
  scanRunIdSchema,
  snapshotIdSchema,
} from "@fpving/core";
import type {
  Alert,
  Listing,
  MatchCandidate,
  PriceSnapshot,
  Product,
  Repository,
  ScanRun,
  Settings,
} from "@fpving/core";
import { ShippingKind, StoreErrorKind } from "@fpving/plugin-sdk";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrate } from "../../../src/adapters/sqlite/migrate.ts";
import { openSqliteRepository } from "../../../src/adapters/sqlite/repository.ts";
import { cleanUpTemp, tempDir } from "./temp-db.ts";

const CREATED = new Date("2026-01-01T00:00:00.001Z");
const LATER = new Date("2026-01-02T00:00:00.002Z");
const PRICE = 12_345;
const SHIPPING = 678;
const SIMILARITY = 0.75;
const STREAK = 2;
const VAT = 1700;
const THRESHOLD = 15_000;
const HOURS = 6;
const DROP = 250;
const RATE = 0.92;

const product: Product = {
  id: productIdSchema.parse("p1"),
  name: "Goggles",
  createdAt: CREATED,
  archivedAt: null,
  cheapestListingId: null,
};
const listing: Listing = {
  id: listingIdSchema.parse("l1"),
  productId: product.id,
  pluginId: pluginIdSchema.parse("example-shop"),
  url: "https://shop.example/goggles",
  title: "Goggles X",
  status: ListingStatus.Stale,
  origin: ListingOrigin.Matched,
  addedAt: CREATED,
  failureStreak: STREAK,
  notFoundStreak: 1,
};
const snapshot: PriceSnapshot = {
  id: snapshotIdSchema.parse("s1"),
  listingId: listing.id,
  observedAt: CREATED,
  shipTo: "IL",
  itemPrice: { amountMinor: PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING, currency: "EUR" },
  inStock: false,
};

describe("SQLite repository storage", () => {
  let path: string;
  let repo: Repository;
  let raw: Database.Database;
  let close: () => void;

  const row = (table: string): unknown => raw.prepare(`select * from ${table}`).get();

  beforeEach(async () => {
    path = join(tempDir(), "fpving.db");
    migrate(path);
    ({ repository: repo, close } = openSqliteRepository(path));
    raw = new Database(path);
    expect(await repo.products.add(product, listing, snapshot)).toEqual({ ok: true, value: undefined });
  });

  afterEach(() => {
    raw.close();
    close();
    cleanUpTemp();
  });

  it("stores every product, listing and snapshot column, instants as UTC epoch milliseconds", async () => {
    await repo.products.setCheapest(product.id, listing.id);
    raw.prepare("update products set archived_at = ?").run(LATER.getTime());
    expect(row("products")).toEqual({
      id: "p1",
      name: "Goggles",
      created_at: CREATED.getTime(),
      archived_at: LATER.getTime(),
      cheapest_listing_id: "l1",
    });
    const stored = { ...product, archivedAt: LATER, cheapestListingId: listing.id };
    expect(await repo.products.get(product.id)).toEqual(stored);
    expect(row("listings")).toEqual({
      id: "l1",
      product_id: "p1",
      plugin_id: "example-shop",
      url: listing.url,
      title: "Goggles X",
      status: "stale",
      origin: "matched",
      added_at: CREATED.getTime(),
      failure_streak: STREAK,
      not_found_streak: 1,
    });
    expect(row("price_snapshots")).toEqual({
      id: "s1",
      listing_id: "l1",
      observed_at: CREATED.getTime(),
      ship_to: "IL",
      item_amount_minor: PRICE,
      item_currency: "USD",
      shipping_kind: "known",
      shipping_amount_minor: SHIPPING,
      shipping_currency: "EUR",
      in_stock: 0,
    });
    expect(await repo.snapshots.listSince(listing.id, CREATED)).toEqual([snapshot]);
  });

  it("stores every match candidate and cached verdict column", async () => {
    const candidate: MatchCandidate = {
      id: matchCandidateIdSchema.parse("c1"),
      productId: product.id,
      pluginId: listing.pluginId,
      url: "https://shop.example/other",
      title: "Goggles Y",
      similarityScore: SIMILARITY,
      llmVerdict: LlmVerdict.Different,
      llmReason: "Another model.",
      status: CandidateStatus.Pending,
    };
    await repo.matchCandidates.save([candidate]);
    expect(row("match_candidates")).toEqual({
      id: "c1",
      product_id: "p1",
      plugin_id: "example-shop",
      url: candidate.url,
      title: "Goggles Y",
      similarity: SIMILARITY,
      llm_verdict: "different",
      llm_reason: "Another model.",
      status: "pending",
    });
    expect(await repo.matchCandidates.listPending()).toEqual([candidate]);
    const verdict = { sourceUrl: listing.url, candidateUrl: candidate.url, verdict: LlmVerdict.Same, reason: "Same." };
    await repo.verdictCache.put({ ...verdict, judgedAt: LATER });
    expect(row("verdict_cache")).toEqual({
      source_url: listing.url,
      candidate_url: candidate.url,
      verdict: "same",
      reason: "Same.",
      judged_at: LATER.getTime(),
    });
  });

  it("stores every alert, scan run and plugin health column", async () => {
    const alert: Alert = {
      id: alertIdSchema.parse("a1"),
      productId: product.id,
      listingId: listing.id,
      kind: AlertKind.BackInStock,
      beforeSnapshotId: snapshot.id,
      afterSnapshotId: snapshot.id,
      createdAt: CREATED,
      readAt: null,
    };
    await repo.alerts.save(alert);
    await repo.alerts.markRead(alert.id, LATER);
    expect(row("alerts")).toEqual({
      id: "a1",
      product_id: "p1",
      listing_id: "l1",
      kind: "back_in_stock",
      before_snapshot_id: "s1",
      after_snapshot_id: "s1",
      created_at: CREATED.getTime(),
      read_at: LATER.getTime(),
    });
    const run: ScanRun = {
      id: scanRunIdSchema.parse("r1"),
      pluginId: listing.pluginId,
      startedAt: CREATED,
      finishedAt: LATER,
      outcome: ScanOutcome.Failed,
      errorKind: StoreErrorKind.Timeout,
    };
    await repo.scanRuns.record(run);
    expect(row("scan_runs")).toEqual({
      id: "r1",
      plugin_id: "example-shop",
      started_at: CREATED.getTime(),
      finished_at: LATER.getTime(),
      outcome: "failed",
      error_kind: "timeout",
    });
    expect(await repo.scanRuns.latest()).toEqual(run);
    await repo.pluginHealth.upsert({ pluginId: listing.pluginId, consecutiveBlocks: STREAK, backoffUntil: LATER });
    expect(row("plugin_health")).toEqual({
      plugin_id: "example-shop",
      consecutive_blocks: STREAK,
      backoff_until: LATER.getTime(),
    });
  });

  it("stores every settings and exchange rate column", async () => {
    const settings: Settings = {
      displayCurrency: "EUR",
      shipToCountry: "DE",
      importTax: {
        dutyFreeThreshold: { amountMinor: THRESHOLD, currency: "EUR" },
        vatBasisPoints: VAT,
        thresholdBasis: ThresholdBasis.ItemAndShipping,
      },
      scanIntervalHours: HOURS,
      priceDropMinBasisPoints: DROP,
    };
    await repo.settings.save(settings);
    await repo.settings.save(settings);
    expect(raw.prepare("select * from settings").all()).toEqual([{
      id: 1,
      display_currency: "EUR",
      ship_to_country: "DE",
      duty_free_amount_minor: THRESHOLD,
      duty_free_currency: "EUR",
      vat_basis_points: VAT,
      threshold_basis: "item_and_shipping",
      scan_interval_hours: HOURS,
      price_drop_min_basis_points: DROP,
    }]);
    expect(await repo.settings.get()).toEqual(settings);
    await repo.fxRates.save({ base: "USD", ratesPerBase: { EUR: RATE }, fetchedOn: "2026-01-02" });
    const ratesJson = `{"EUR":${String(RATE)}}`;
    expect(row("fx_tables")).toEqual({ id: 1, base: "USD", rates_json: ratesJson, fetched_on: "2026-01-02" });
  });

  it("enforces foreign keys in the database, refusing dangling references and deleting a referenced row", async () => {
    await expect(repo.alerts.save({
      id: alertIdSchema.parse("a1"),
      productId: product.id,
      listingId: listingIdSchema.parse("missing"),
      kind: AlertKind.PriceDrop,
      beforeSnapshotId: null,
      afterSnapshotId: snapshot.id,
      createdAt: CREATED,
      readAt: null,
    })).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
    raw.pragma("foreign_keys = ON");
    expect(() => raw.prepare("delete from products").run()).toThrow("FOREIGN KEY constraint failed");
  });

  it("refuses rows that break the entity rules through check constraints", () => {
    const failed = (name: string): string => `CHECK constraint failed: ${name}`;
    const run = (statement: string, ...params: unknown[]) => () => raw.prepare(statement).run(...params);
    const snapshotRow = "insert into price_snapshots values ('s2', 'l1', 0, 'IL', 1, 'USD', ?, ?, ?, 1)";
    const shipping = failed("price_snapshots_shipping_check");
    expect(run(snapshotRow, ShippingKind.Unknown, SHIPPING, "USD")).toThrow(shipping);
    expect(run(snapshotRow, ShippingKind.Known, null, null)).toThrow(shipping);
    expect(run(snapshotRow, "free", null, null)).toThrow(failed("price_snapshots_shipping_kind_check"));
    const scanRow = "insert into scan_runs values ('r1', 'x', 0, 0, ?, ?)";
    expect(run(scanRow, ScanOutcome.Ok, StoreErrorKind.Timeout)).toThrow(failed("scan_runs_error_kind_null_check"));
    expect(run(scanRow, ScanOutcome.Failed, null)).toThrow(failed("scan_runs_error_kind_null_check"));
    expect(run(scanRow, ScanOutcome.Failed, "teapot")).toThrow(failed("scan_runs_error_kind_check"));
    const candidateRow = "insert into match_candidates values ('c1', 'p1', 'x', 'https://a.example/', 't', 0.5, ?, ?, ?)";
    expect(run(candidateRow, LlmVerdict.Same, null, CandidateStatus.Pending))
      .toThrow(failed("match_candidates_llm_reason_check"));
    expect(run(candidateRow, LlmVerdict.Unjudged, "Why.", CandidateStatus.Pending))
      .toThrow(failed("match_candidates_llm_reason_check"));
    expect(run("insert into settings values (2, 'USD', 'US', 0, 'USD', 0, 'item', 1, 0)"))
      .toThrow(failed("settings_singleton_check"));
  });

  it("has only the unique indexes the refusal maps rely on: primary keys, listing url, candidate product+url", () => {
    const uniqueIndexes = ["products", "listings", "price_snapshots", "match_candidates"].flatMap((table) =>
      z.array(z.looseObject({ name: z.string(), unique: z.number(), origin: z.string() }))
        .parse(raw.pragma(`index_list(${table})`))
        .filter((index) => index.unique === 1)
        .map(({ name, origin }) => ({ table, name, origin })));
    expect(uniqueIndexes.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { table: "listings", name: "listings_url_unique", origin: "c" },
      { table: "match_candidates", name: "match_candidates_product_id_url_unique", origin: "c" },
      { table: "listings", name: "sqlite_autoindex_listings_1", origin: "pk" },
      { table: "match_candidates", name: "sqlite_autoindex_match_candidates_1", origin: "pk" },
      { table: "price_snapshots", name: "sqlite_autoindex_price_snapshots_1", origin: "pk" },
      { table: "products", name: "sqlite_autoindex_products_1", origin: "pk" },
    ]);
  });

  it("rejects a stored row that no longer parses as its entity", async () => {
    raw.prepare("update listings set url = 'not a url'").run();
    await expect(repo.listings.listByProduct(product.id)).rejects.toThrow();
  });
});
