import { ShippingKind, ShippingUnknown } from "@fpving/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AlertKind,
  alertIdSchema,
  CandidateStatus,
  DEFAULT_SETTINGS,
  LlmVerdict,
  ListingOrigin,
  ListingStatus,
  listingIdSchema,
  matchCandidateIdSchema,
  productIdSchema,
  RepositoryErrorKind,
  ScanOutcome,
  scanRunIdSchema,
  snapshotIdSchema,
} from "../src/index.ts";
import type {
  Alert,
  CachedVerdict,
  FxTable,
  Listing,
  ListingId,
  MatchCandidate,
  PriceSnapshot,
  Product,
  ProductId,
  Repository,
  ScanRun,
  Settings,
} from "../src/index.ts";

const PRICE = 1999;
const SHIPPING = 500;
const HIGH_SIMILARITY = 0.9;
const LOW_SIMILARITY = 0.4;
const FAILURES = 3;
const BLOCKS = 2;
const SCAN_HOURS = 24;
const DROP_BASIS_POINTS = 1000;
const ILS_PER_USD = 3.6;
const PLUGIN = "example-shop";
const OTHER_PLUGIN = "other-shop";

const JAN_1 = new Date("2026-01-01T00:00:00Z");
const JAN_2 = new Date("2026-01-02T00:00:00Z");
const JAN_3 = new Date("2026-01-03T00:00:00Z");

const product = (id: string): Product => ({
  id: productIdSchema.parse(id),
  name: `Product ${id}`,
  createdAt: JAN_1,
  archivedAt: null,
});

const listing = (id: string, productId: ProductId, url: string): Listing => ({
  id: listingIdSchema.parse(id),
  productId,
  pluginId: PLUGIN,
  url,
  title: `Listing ${id}`,
  status: ListingStatus.Active,
  origin: ListingOrigin.Manual,
  addedAt: JAN_1,
  failureStreak: 0,
  notFoundStreak: 0,
});

const snapshot = (id: string, listingId: ListingId, day: Date): PriceSnapshot => ({
  id: snapshotIdSchema.parse(id),
  listingId,
  observedAt: day,
  shipTo: "IL",
  itemPrice: { amountMinor: PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING, currency: "USD" },
  inStock: true,
});

const candidate = (id: string, productId: ProductId, url: string, similarityScore: number): MatchCandidate => ({
  id: matchCandidateIdSchema.parse(id),
  productId,
  pluginId: OTHER_PLUGIN,
  url,
  title: `Candidate ${id}`,
  similarityScore,
  llmVerdict: LlmVerdict.Unjudged,
  llmReason: null,
  status: CandidateStatus.Pending,
});

const alert = (id: string, listingRow: Listing, day: Date): Alert => ({
  id: alertIdSchema.parse(id),
  productId: listingRow.productId,
  listingId: listingRow.id,
  kind: AlertKind.PriceDrop,
  beforeSnapshotId: null,
  afterSnapshotId: snapshotIdSchema.parse(`s-${id}`),
  createdAt: day,
  readAt: null,
});

const scanRun = (id: string, pluginId: string, day: Date): ScanRun => ({
  id: scanRunIdSchema.parse(id),
  pluginId,
  startedAt: day,
  finishedAt: day,
  outcome: ScanOutcome.Ok,
  errorKind: null,
});

const url = (path: string): string => `https://shop.example/${path}`;

/**
 * Registers the behaviour every {@link Repository} implementation must have. Each test gets a fresh, empty
 * repository from `makeRepository`.
 */
export const describeRepositoryContract = (name: string, makeRepository: () => Promise<Repository>): void => {
  describe(`${name} repository contract`, () => {
    let repo: Repository;
    const p1 = product("p1");
    const p2 = product("p2");
    const l1 = listing("l1", p1.id, url("one"));
    const l2 = listing("l2", p2.id, url("two"));

    beforeEach(async () => {
      repo = await makeRepository();
    });

    describe("products", () => {
      it("stores a product with its first listing, found afterwards by the listing url", async () => {
        expect(await repo.products.add(p1, l1)).toEqual({ ok: true, value: undefined });
        expect(await repo.listings.findByUrl(l1.url)).toEqual(l1);
      });

      it("refuses a product whose first listing url is already tracked and stores nothing", async () => {
        await repo.products.add(p1, l1);
        const duplicate = { ...l2, url: l1.url };
        expect(await repo.products.add(p2, duplicate)).toEqual({
          ok: false,
          error: { kind: RepositoryErrorKind.DuplicateUrl },
        });
        expect(await repo.listings.listByProduct(p2.id)).toEqual([]);
      });
    });

    describe("listings", () => {
      beforeEach(async () => {
        await repo.products.add(p1, l1);
        await repo.products.add(p2, l2);
      });

      it("finds no listing for a url that is not tracked", async () => {
        expect(await repo.listings.findByUrl(url("unknown"))).toBeNull();
      });

      it("adds a listing to an existing product and lists a product's listings oldest first", async () => {
        const later = { ...listing("l3", p1.id, url("three")), origin: ListingOrigin.Matched, addedAt: JAN_2 };
        expect(await repo.listings.add(later)).toEqual({ ok: true, value: undefined });
        expect(await repo.listings.listByProduct(p1.id)).toEqual([l1, later]);
      });

      it("refuses a listing for a product that does not exist", async () => {
        const orphan = listing("l3", productIdSchema.parse("missing"), url("three"));
        expect(await repo.listings.add(orphan)).toEqual({ ok: false, error: { kind: RepositoryErrorKind.NotFound } });
      });

      it("refuses a listing whose url is already tracked", async () => {
        const duplicate = { ...listing("l3", p1.id, l2.url) };
        expect(await repo.listings.add(duplicate)).toEqual({
          ok: false,
          error: { kind: RepositoryErrorKind.DuplicateUrl },
        });
      });

      it("updates a listing's status and failure streaks", async () => {
        const update = { status: ListingStatus.Stale, failureStreak: FAILURES, notFoundStreak: 1 };
        expect(await repo.listings.updateStatus(l1.id, update)).toEqual({ ok: true, value: undefined });
        expect(await repo.listings.findByUrl(l1.url)).toEqual({ ...l1, ...update });
      });

      it("reports not_found when updating a listing that does not exist", async () => {
        const update = { status: ListingStatus.Gone, failureStreak: 0, notFoundStreak: 0 };
        expect(await repo.listings.updateStatus(listingIdSchema.parse("missing"), update)).toEqual({
          ok: false,
          error: { kind: RepositoryErrorKind.NotFound },
        });
      });
    });

    describe("price snapshots", () => {
      beforeEach(async () => {
        await repo.products.add(p1, l1);
        await repo.products.add(p2, l2);
      });

      it("returns a listing's snapshots observed at or after a date, oldest first, as stored", async () => {
        const unknownShipping = { ...snapshot("s3", l1.id, JAN_3), shipping: ShippingUnknown, shipTo: "US" as const };
        for (const row of [unknownShipping, snapshot("s1", l1.id, JAN_1), snapshot("s2", l1.id, JAN_2)]) {
          expect(await repo.snapshots.append(row)).toEqual({ ok: true, value: undefined });
        }
        await repo.snapshots.append(snapshot("s4", l2.id, JAN_2));
        expect(await repo.snapshots.listSince(l1.id, JAN_2)).toEqual([snapshot("s2", l1.id, JAN_2), unknownShipping]);
      });

      it("refuses a snapshot for a listing that does not exist", async () => {
        const orphan = snapshot("s1", listingIdSchema.parse("missing"), JAN_1);
        expect(await repo.snapshots.append(orphan)).toEqual({
          ok: false,
          error: { kind: RepositoryErrorKind.NotFound },
        });
      });

      it("returns the latest snapshot of each of a product's listings that has one", async () => {
        const l3 = listing("l3", p1.id, url("three"));
        const l4 = listing("l4", p1.id, url("four"));
        await repo.listings.add(l3);
        await repo.listings.add(l4);
        for (const row of [
          snapshot("s2", l1.id, JAN_2),
          snapshot("s1", l1.id, JAN_1),
          snapshot("s3", l3.id, JAN_1),
          snapshot("s4", l2.id, JAN_3),
        ]) {
          await repo.snapshots.append(row);
        }
        const latest = await repo.snapshots.latestPerListing(p1.id);
        expect(latest.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual([
          snapshot("s2", l1.id, JAN_2),
          snapshot("s3", l3.id, JAN_1),
        ]);
      });
    });

    describe("match candidates", () => {
      beforeEach(async () => {
        await repo.products.add(p1, l1);
        await repo.products.add(p2, l2);
      });

      it("lists pending candidates highest similarity first and leaves out decided ones", async () => {
        const low = candidate("c1", p1.id, url("c1"), LOW_SIMILARITY);
        const high = candidate("c2", p2.id, url("c2"), HIGH_SIMILARITY);
        const decided = candidate("c3", p1.id, url("c3"), HIGH_SIMILARITY);
        expect(await repo.matchCandidates.save([low, high, decided])).toEqual({ ok: true, value: undefined });
        expect(await repo.matchCandidates.setStatus(decided.id, CandidateStatus.Rejected)).toEqual({
          ok: true,
          value: undefined,
        });
        expect(await repo.matchCandidates.listPending()).toEqual([high, low]);
      });

      it("reports not_found when setting the status of a candidate that does not exist", async () => {
        const missing = matchCandidateIdSchema.parse("missing");
        expect(await repo.matchCandidates.setStatus(missing, CandidateStatus.Accepted)).toEqual({
          ok: false,
          error: { kind: RepositoryErrorKind.NotFound },
        });
      });

      it("refuses a batch repeating a url already suggested for the same product and saves none of it", async () => {
        await repo.matchCandidates.save([candidate("c1", p1.id, url("c1"), LOW_SIMILARITY)]);
        const fresh = candidate("c2", p1.id, url("c2"), LOW_SIMILARITY);
        const again = candidate("c3", p1.id, url("c1"), HIGH_SIMILARITY);
        expect(await repo.matchCandidates.save([fresh, again])).toEqual({
          ok: false,
          error: { kind: RepositoryErrorKind.DuplicateUrl },
        });
        expect(await repo.matchCandidates.listPending()).toEqual([candidate("c1", p1.id, url("c1"), LOW_SIMILARITY)]);
      });

      it("treats a url as known for a product once suggested for it, even if rejected", async () => {
        const rejected = candidate("c1", p1.id, url("c1"), LOW_SIMILARITY);
        await repo.matchCandidates.save([rejected]);
        await repo.matchCandidates.setStatus(rejected.id, CandidateStatus.Rejected);
        expect(await repo.matchCandidates.isKnownUrl(p1.id, rejected.url)).toBe(true);
        expect(await repo.matchCandidates.isKnownUrl(p2.id, rejected.url)).toBe(false);
      });

      it("treats a url as known for every product once any listing tracks it", async () => {
        expect(await repo.matchCandidates.isKnownUrl(p1.id, l2.url)).toBe(true);
        expect(await repo.matchCandidates.isKnownUrl(p1.id, url("unknown"))).toBe(false);
      });
    });

    describe("llm verdict cache", () => {
      const entry: CachedVerdict = {
        sourceUrl: url("source"),
        candidateUrl: url("candidate"),
        verdict: LlmVerdict.Same,
        reason: "Same model and variant.",
        judgedAt: JAN_1,
      };

      it("has no verdict for a url pair that was never judged", async () => {
        expect(await repo.verdictCache.get(entry.sourceUrl, entry.candidateUrl)).toBeNull();
      });

      it("returns the last verdict stored for a source and candidate url, and none for the reversed pair", async () => {
        await repo.verdictCache.put(entry);
        const rejudged = { ...entry, verdict: LlmVerdict.Variant, reason: "Different battery size.", judgedAt: JAN_2 };
        await repo.verdictCache.put(rejudged);
        expect(await repo.verdictCache.get(entry.sourceUrl, entry.candidateUrl)).toEqual(rejudged);
        expect(await repo.verdictCache.get(entry.candidateUrl, entry.sourceUrl)).toBeNull();
      });
    });

    describe("alerts", () => {
      beforeEach(async () => {
        await repo.products.add(p1, l1);
      });

      it("lists alerts newest first, or only the unread ones when asked", async () => {
        const older = alert("a1", l1, JAN_1);
        const newer = alert("a2", l1, JAN_2);
        await repo.alerts.save(older);
        await repo.alerts.save(newer);
        expect(await repo.alerts.markRead(older.id, JAN_3)).toEqual({ ok: true, value: undefined });
        expect(await repo.alerts.list({ unreadOnly: false })).toEqual([newer, { ...older, readAt: JAN_3 }]);
        expect(await repo.alerts.list({ unreadOnly: true })).toEqual([newer]);
      });

      it("reports not_found when marking an alert read that does not exist", async () => {
        expect(await repo.alerts.markRead(alertIdSchema.parse("missing"), JAN_1)).toEqual({
          ok: false,
          error: { kind: RepositoryErrorKind.NotFound },
        });
      });
    });

    describe("scan runs", () => {
      it("has no latest scan run before any scan ran", async () => {
        expect(await repo.scanRuns.latest()).toBeNull();
        expect(await repo.scanRuns.latest(PLUGIN)).toBeNull();
      });

      it("returns the most recently started scan run overall and per plugin", async () => {
        const failed = {
          ...scanRun("r3", OTHER_PLUGIN, JAN_3),
          outcome: ScanOutcome.Blocked,
          errorKind: "blocked" as const,
        };
        for (const run of [scanRun("r2", PLUGIN, JAN_2), failed, scanRun("r1", PLUGIN, JAN_1)]) {
          await repo.scanRuns.record(run);
        }
        expect(await repo.scanRuns.latest()).toEqual(failed);
        expect(await repo.scanRuns.latest(PLUGIN)).toEqual(scanRun("r2", PLUGIN, JAN_2));
      });
    });

    describe("fx rates", () => {
      const table = (fetchedOn: string): FxTable => ({ base: "USD", ratesPerBase: { ILS: ILS_PER_USD }, fetchedOn });

      it("has no rates before any were saved", async () => {
        expect(await repo.fxRates.latest()).toBeNull();
      });

      it("returns the last saved rate table", async () => {
        await repo.fxRates.save(table("2026-01-01"));
        await repo.fxRates.save(table("2026-01-02"));
        expect(await repo.fxRates.latest()).toEqual(table("2026-01-02"));
      });
    });

    describe("plugin health", () => {
      it("reports a plugin without a record as healthy: no blocks and no backoff", async () => {
        expect(await repo.pluginHealth.get(PLUGIN)).toEqual({
          pluginId: PLUGIN,
          consecutiveBlocks: 0,
          backoffUntil: null,
        });
      });

      it("returns the health last upserted for each plugin", async () => {
        const blocked = { pluginId: PLUGIN, consecutiveBlocks: 1, backoffUntil: JAN_2 };
        const worse = { ...blocked, consecutiveBlocks: BLOCKS, backoffUntil: JAN_3 };
        const other = { pluginId: OTHER_PLUGIN, consecutiveBlocks: 1, backoffUntil: JAN_2 };
        await repo.pluginHealth.upsert(blocked);
        await repo.pluginHealth.upsert(other);
        await repo.pluginHealth.upsert(worse);
        expect(await repo.pluginHealth.get(PLUGIN)).toEqual(worse);
        expect(await repo.pluginHealth.get(OTHER_PLUGIN)).toEqual(other);
      });
    });

    describe("settings", () => {
      it("returns the default settings until settings are saved", async () => {
        expect(await repo.settings.get()).toEqual(DEFAULT_SETTINGS);
      });

      it("returns the last saved settings", async () => {
        const saved: Settings = {
          ...DEFAULT_SETTINGS,
          displayCurrency: "EUR",
          scanIntervalHours: SCAN_HOURS,
          priceDropMinBasisPoints: DROP_BASIS_POINTS,
        };
        await repo.settings.save(saved);
        expect(await repo.settings.get()).toEqual(saved);
      });
    });
  });
};
