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
  pluginIdSchema,
  productIdSchema,
  RepositoryErrorKind,
  ScanOutcome,
  scanRunIdSchema,
  snapshotIdSchema,
} from "../index.js";
import type {
  Alert,
  CachedVerdict,
  FxTable,
  Listing,
  ListingId,
  MatchCandidate,
  PluginId,
  PriceSnapshot,
  Product,
  ProductId,
  Repository,
  ScanRun,
  Settings,
  SnapshotId,
} from "../index.js";

const PRICE = 1999;
const SHIPPING = 500;
const ASTRAL_ID_LOW = "id\uFFFF";
const ASTRAL_ID_HIGH = "id\u{10000}";
const HIGH_SIMILARITY = 0.9;
const LOW_SIMILARITY = 0.4;
const FAILURES = 3;
const BLOCKS = 2;
const SCAN_HOURS = 24;
const DROP_BASIS_POINTS = 1000;
const ILS_PER_USD = 3.6;
const PLUGIN = pluginIdSchema.parse("example-shop");
const OTHER_PLUGIN = pluginIdSchema.parse("other-shop");

const JAN_1 = new Date("2026-01-01T03:04:05.678Z");
const JAN_2 = new Date("2026-01-02T03:04:05.678Z");
const JAN_3 = new Date("2026-01-03T03:04:05.678Z");
const JUST_BEFORE_JAN_2 = new Date(JAN_2.getTime() - 1);

const ok = { ok: true, value: undefined };
const notFound = { ok: false, error: { kind: RepositoryErrorKind.NotFound } };
const duplicateUrl = { ok: false, error: { kind: RepositoryErrorKind.DuplicateUrl } };

const product = (id: string): Product => ({
  id: productIdSchema.parse(id),
  name: `Product ${id}`,
  createdAt: JAN_1,
  archivedAt: null,
  cheapestListingId: null,
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

const snapshot = (id: string, listingId: ListingId, observedAt: Date): PriceSnapshot => ({
  id: snapshotIdSchema.parse(id),
  listingId,
  observedAt,
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

const alert = (id: string, row: Listing, createdAt: Date, afterSnapshotId: SnapshotId): Alert => ({
  id: alertIdSchema.parse(id),
  productId: row.productId,
  listingId: row.id,
  kind: AlertKind.PriceDrop,
  beforeSnapshotId: null,
  afterSnapshotId,
  createdAt,
  readAt: null,
});

const scanRun = (id: string, pluginId: PluginId, startedAt: Date): ScanRun => ({
  id: scanRunIdSchema.parse(id),
  pluginId,
  startedAt,
  finishedAt: startedAt,
  outcome: ScanOutcome.Ok,
  errorKind: null,
});

const url = (path: string): string => `https://shop.example/${path}`;

/**
 * Registers the behaviour every {@link Repository} implementation must have, as a Vitest suite named "Repository
 * contract". Each test gets a fresh, empty repository from `makeRepository`.
 *
 * @example
 * ```ts
 * import { describeRepositoryContract } from "@fpving/core/testing";
 * import { sqliteRepository } from "../src/index.js";
 *
 * describeRepositoryContract(async () => sqliteRepository(":memory:"));
 * ```
 */
export const describeRepositoryContract = (makeRepository: () => Promise<Repository>): void => {
  describe("Repository contract", () => {
    let repo: Repository;
    const p1 = product("p1");
    const p2 = product("p2");
    const l1 = listing("l1", p1.id, url("one"));
    const l2 = listing("l2", p2.id, url("two"));
    const s1 = snapshot("s1", l1.id, JAN_1);
    const s2 = snapshot("s2", l2.id, JAN_1);
    const missingProduct = productIdSchema.parse("missing");
    const missingListing = listingIdSchema.parse("missing");

    const expectActive = async (row: Listing, history: readonly PriceSnapshot[]): Promise<void> => {
      expect(await repo.listings.findByUrl(row.url)).toEqual(row);
      expect(await repo.snapshots.listSince(row.id, JAN_1)).toEqual(history);
    };

    const seed = async (): Promise<void> => {
      await repo.products.add(p1, l1, s1);
      await repo.products.add(p2, l2, s2);
    };

    beforeEach(async () => {
      repo = await makeRepository();
    });

    describe("Products", () => {
      it("stores a product with its first listing and first snapshot", async () => {
        expect(await repo.products.add(p1, l1, s1)).toEqual(ok);
        expect(await repo.listings.findByUrl(l1.url)).toEqual(l1);
        expect(await repo.snapshots.listSince(l1.id, JAN_1)).toEqual([s1]);
      });

      it("refuses a product whose first listing url is already tracked and stores none of the three", async () => {
        await repo.products.add(p1, l1, s1);
        expect(await repo.products.add(p2, { ...l2, url: l1.url }, s2)).toEqual(duplicateUrl);
        const l3 = listing("l3", p2.id, url("three"));
        expect(await repo.listings.addWithSnapshot(l3, snapshot("s3", l3.id, JAN_2))).toEqual(notFound);
        expect(await repo.snapshots.append(snapshot("s3", l2.id, JAN_2))).toEqual(notFound);
        expect(await repo.snapshots.append(s2)).toEqual(notFound);
      });

      it("rejects a first listing of another product or a first snapshot of another listing as a bug", async () => {
        await expect(repo.products.add(p1, { ...l1, productId: p2.id }, s1)).rejects.toThrow();
        await expect(repo.products.add(p1, l1, { ...s1, listingId: l2.id })).rejects.toThrow();
      });

      it("rejects a new product that already names a cheapest listing as a bug and stores nothing", async () => {
        await expect(repo.products.add({ ...p1, cheapestListingId: l1.id }, l1, s1)).rejects.toThrow();
        expect(await repo.products.get(p1.id)).toBeNull();
        expect(await repo.listings.findByUrl(l1.url)).toBeNull();
      });

      it("reads a stored product, and none for an id that is not stored", async () => {
        await repo.products.add(p1, l1, s1);
        expect(await repo.products.get(p1.id)).toEqual(p1);
        expect(await repo.products.get(missingProduct)).toBeNull();
      });

      it("sets and clears a product's cheapest listing", async () => {
        await repo.products.add(p1, l1, s1);
        expect(await repo.products.setCheapest(p1.id, l1.id)).toEqual(ok);
        expect(await repo.products.get(p1.id)).toEqual({ ...p1, cheapestListingId: l1.id });
        expect(await repo.products.setCheapest(p1.id, null)).toEqual(ok);
        expect(await repo.products.get(p1.id)).toEqual(p1);
      });

      it("rejects a cheapest listing that is missing or another product's as a bug, changing nothing", async () => {
        await seed();
        await expect(repo.products.setCheapest(p1.id, missingListing)).rejects.toThrow();
        await expect(repo.products.setCheapest(p1.id, l2.id)).rejects.toThrow();
        expect(await repo.products.get(p1.id)).toEqual(p1);
      });

      it("reports not_found when setting the cheapest listing of a product that does not exist", async () => {
        expect(await repo.products.setCheapest(missingProduct, null)).toEqual(notFound);
      });

      it("lists the products that are not archived newest first, the greater id first on a tie", async () => {
        const newer = { ...product("p3"), createdAt: JAN_2 };
        const tied = { ...product("p4"), createdAt: JAN_2 };
        const archived = product("p5");
        for (const row of [p1, newer, tied, archived]) {
          const first = listing(`l-${row.id}`, row.id, url(row.id));
          await repo.products.add(row, first, snapshot(`s-${row.id}`, first.id, JAN_1));
        }
        expect(await repo.products.archive(archived.id, JAN_3)).toEqual(ok);
        expect(await repo.products.list()).toEqual([tied, newer, p1]);
      });

      it("archives a product at an instant, still reading it, and refuses a missing or archived one", async () => {
        await repo.products.add(p1, l1, s1);
        expect(await repo.products.archive(p1.id, JAN_2)).toEqual(ok);
        expect(await repo.products.get(p1.id)).toEqual({ ...p1, archivedAt: JAN_2 });
        expect(await repo.products.archive(p1.id, JAN_3)).toEqual(notFound);
        expect(await repo.products.archive(missingProduct, JAN_3)).toEqual(notFound);
        expect(await repo.products.get(p1.id)).toEqual({ ...p1, archivedAt: JAN_2 });
      });

      it("renames a product, and refuses a missing or archived one", async () => {
        await seed();
        expect(await repo.products.rename(p1.id, "Renamed")).toEqual(ok);
        expect(await repo.products.get(p1.id)).toEqual({ ...p1, name: "Renamed" });
        await repo.products.archive(p2.id, JAN_2);
        expect(await repo.products.rename(p2.id, "Renamed")).toEqual(notFound);
        expect(await repo.products.rename(missingProduct, "Renamed")).toEqual(notFound);
        expect(await repo.products.get(p2.id)).toEqual({ ...p2, archivedAt: JAN_2 });
      });

      it("restores an archived product, making its listing active with a new snapshot, keeping history", async () => {
        await seed();
        const gone = { status: ListingStatus.Gone, failureStreak: FAILURES, notFoundStreak: 2 };
        await repo.listings.updateStatus(l1.id, gone);
        await repo.products.archive(p1.id, JAN_2);
        const s3 = snapshot("s3", l1.id, JAN_3);
        expect(await repo.products.restore(p1.id, s3)).toEqual(ok);
        expect(await repo.products.list()).toEqual([p2, p1]);
        await expectActive(l1, [s1, s3]);
      });

      it("refuses to restore a missing product or one that is not archived, changing nothing", async () => {
        await seed();
        expect(await repo.products.restore(p1.id, snapshot("s3", l1.id, JAN_3))).toEqual(notFound);
        expect(await repo.products.restore(missingProduct, snapshot("s4", l1.id, JAN_3))).toEqual(notFound);
        expect(await repo.snapshots.listSince(l1.id, JAN_1)).toEqual([s1]);
      });

      it("rejects restoring a product with a snapshot of another product's listing as a bug", async () => {
        await seed();
        await repo.products.archive(p1.id, JAN_2);
        await expect(repo.products.restore(p1.id, snapshot("s3", l2.id, JAN_3))).rejects.toThrow();
        expect(await repo.products.get(p1.id)).toEqual({ ...p1, archivedAt: JAN_2 });
        expect(await repo.snapshots.listSince(l2.id, JAN_1)).toEqual([s2]);
      });

      it("rejects a product id that is already stored as a bug", async () => {
        await repo.products.add(p1, l1, s1);
        const l3 = listing("l3", p1.id, url("three"));
        await expect(repo.products.add(p1, l3, snapshot("s3", l3.id, JAN_1))).rejects.toThrow();
      });
    });

    describe("Listings", () => {
      beforeEach(seed);

      it("finds no listing for a url that is not tracked", async () => {
        expect(await repo.listings.findByUrl(url("unknown"))).toBeNull();
      });

      it("lists a product's listings oldest first", async () => {
        const later = { ...listing("l3", p1.id, url("three")), origin: ListingOrigin.Matched, addedAt: JAN_2 };
        expect(await repo.listings.addWithSnapshot(later, snapshot("s3", later.id, JAN_2))).toEqual(ok);
        expect(await repo.listings.listByProduct(p1.id)).toEqual([l1, later]);
      });

      it("adds a listing with its first snapshot in one step", async () => {
        const l3 = listing("l3", p1.id, url("three"));
        const s3 = snapshot("s3", l3.id, JAN_2);
        expect(await repo.listings.addWithSnapshot(l3, s3)).toEqual(ok);
        expect(await repo.listings.findByUrl(l3.url)).toEqual(l3);
        expect(await repo.snapshots.listSince(l3.id, JAN_1)).toEqual([s3]);
      });

      it("refuses a listing with a snapshot for a missing product or a tracked url and stores neither", async () => {
        const orphan = listing("l3", missingProduct, url("three"));
        expect(await repo.listings.addWithSnapshot(orphan, snapshot("s3", orphan.id, JAN_2))).toEqual(notFound);
        const tracked = listing("l4", p1.id, l2.url);
        expect(await repo.listings.addWithSnapshot(tracked, snapshot("s4", tracked.id, JAN_2))).toEqual(duplicateUrl);
        expect(await repo.snapshots.append(snapshot("s5", orphan.id, JAN_2))).toEqual(notFound);
        expect(await repo.snapshots.listSince(orphan.id, JAN_1)).toEqual([]);
        expect(await repo.snapshots.listSince(tracked.id, JAN_1)).toEqual([]);
        expect(await repo.snapshots.append(snapshot("s6", tracked.id, JAN_2))).toEqual(notFound);
        expect(await repo.listings.listByProduct(p1.id)).toEqual([l1]);
      });

      it("refuses a listing for an archived product with not_found and stores neither", async () => {
        await repo.products.archive(p1.id, JAN_2);
        const l3 = listing("l3", p1.id, url("three"));
        expect(await repo.listings.addWithSnapshot(l3, snapshot("s3", l3.id, JAN_2))).toEqual(notFound);
        expect(await repo.listings.listByProduct(p1.id)).toEqual([l1]);
        expect(await repo.snapshots.listSince(l3.id, JAN_1)).toEqual([]);
      });

      it("rejects a snapshot of another listing, or a listing or snapshot id already stored, as a bug", async () => {
        const l3 = listing("l3", p1.id, url("three"));
        await expect(repo.listings.addWithSnapshot(l3, snapshot("s3", l1.id, JAN_2))).rejects.toThrow();
        const reused = listing("l1", p1.id, url("three"));
        await expect(repo.listings.addWithSnapshot(reused, snapshot("s3", reused.id, JAN_2))).rejects.toThrow();
        await expect(repo.listings.addWithSnapshot(l3, snapshot("s1", l3.id, JAN_2))).rejects.toThrow();
        expect(await repo.listings.findByUrl(l3.url)).toBeNull();
      });

      it("updates a listing's status and failure streaks", async () => {
        const update = { status: ListingStatus.Stale, failureStreak: FAILURES, notFoundStreak: 1 };
        expect(await repo.listings.updateStatus(l1.id, update)).toEqual(ok);
        expect(await repo.listings.findByUrl(l1.url)).toEqual({ ...l1, ...update });
      });

      it("reports not_found when updating a listing that does not exist", async () => {
        const update = { status: ListingStatus.Gone, failureStreak: 0, notFoundStreak: 0 };
        expect(await repo.listings.updateStatus(missingListing, update)).toEqual(notFound);
      });

      it("lists active and stale listings of live products to scan, by plugin, then product, then age", async () => {
        const otherPlugin = { ...listing("l3", p1.id, url("three")), pluginId: OTHER_PLUGIN };
        const stale = { ...listing("l4", p1.id, url("four")), addedAt: JAN_2, status: ListingStatus.Stale };
        const gone = { ...listing("l5", p2.id, url("five")), status: ListingStatus.Gone };
        const removed = { ...listing("l7", p2.id, url("seven")), status: ListingStatus.Removed };
        const archived = { ...product("p3"), archivedAt: JAN_2 };
        const ofArchived = listing("l6", archived.id, url("six"));
        for (const row of [otherPlugin, stale, gone, removed]) {
          await repo.listings.addWithSnapshot(row, snapshot(`s-${row.id}`, row.id, JAN_2));
        }
        await repo.products.add(archived, ofArchived, snapshot("s6", ofArchived.id, JAN_2));
        expect(await repo.listings.listToScan()).toEqual([l1, stale, l2, otherPlugin]);
      });

      it("removes a product's listing, clearing the product's cheapest when it was that listing", async () => {
        const l3 = listing("l3", p1.id, url("three"));
        await repo.listings.addWithSnapshot(l3, snapshot("s3", l3.id, JAN_2));
        await repo.products.setCheapest(p1.id, l3.id);
        expect(await repo.listings.remove(p1.id, l1.id)).toEqual(ok);
        expect(await repo.products.get(p1.id)).toEqual({ ...p1, cheapestListingId: l3.id });
        expect(await repo.listings.remove(p1.id, l3.id)).toEqual(ok);
        expect(await repo.products.get(p1.id)).toEqual(p1);
        expect(await repo.listings.listByProduct(p1.id)).toEqual([
          { ...l1, status: ListingStatus.Removed },
          { ...l3, status: ListingStatus.Removed },
        ]);
        expect(await repo.snapshots.listSince(l1.id, JAN_1)).toEqual([s1]);
      });

      it("refuses to remove a missing, already removed or another product's listing, changing nothing", async () => {
        expect(await repo.listings.remove(p1.id, missingListing)).toEqual(notFound);
        expect(await repo.listings.remove(p2.id, l1.id)).toEqual(notFound);
        expect(await repo.listings.remove(p1.id, l1.id)).toEqual(ok);
        expect(await repo.listings.remove(p1.id, l1.id)).toEqual(notFound);
        expect(await repo.listings.listByProduct(p2.id)).toEqual([l2]);
      });

      it("keeps a removed listing removed when its status is updated, as by a scan that was running", async () => {
        await repo.listings.remove(p1.id, l1.id);
        const update = { status: ListingStatus.Active, failureStreak: 0, notFoundStreak: 1 };
        expect(await repo.listings.updateStatus(l1.id, update)).toEqual(ok);
        expect(await repo.listings.findByUrl(l1.url)).toEqual({ ...l1, ...update, status: ListingStatus.Removed });
      });

      it("restores a removed listing of a live product as active with a new snapshot, keeping history", async () => {
        const stale = { status: ListingStatus.Stale, failureStreak: FAILURES, notFoundStreak: 1 };
        await repo.listings.updateStatus(l1.id, stale);
        await repo.listings.remove(p1.id, l1.id);
        const s3 = snapshot("s3", l1.id, JAN_3);
        expect(await repo.listings.restore(p1.id, s3)).toEqual(ok);
        await expectActive(l1, [s1, s3]);
      });

      it("refuses to restore a listing missing, not removed, another product's or of an archived product", async () => {
        expect(await repo.listings.restore(p1.id, snapshot("s3", l1.id, JAN_3))).toEqual(notFound);
        expect(await repo.listings.restore(p1.id, snapshot("s4", missingListing, JAN_3))).toEqual(notFound);
        await repo.listings.remove(p1.id, l1.id);
        expect(await repo.listings.restore(p2.id, snapshot("s5", l1.id, JAN_3))).toEqual(notFound);
        await repo.listings.remove(p2.id, l2.id);
        await repo.products.archive(p2.id, JAN_2);
        expect(await repo.listings.restore(p2.id, snapshot("s6", l2.id, JAN_3))).toEqual(notFound);
        expect(await repo.listings.listByProduct(p2.id)).toEqual([{ ...l2, status: ListingStatus.Removed }]);
        expect(await repo.snapshots.listSince(l1.id, JAN_1)).toEqual([s1]);
        expect(await repo.snapshots.listSince(l2.id, JAN_1)).toEqual([s2]);
      });

      it("returns copies, so changing a returned row does not change the stored one", async () => {
        for (const row of await repo.listings.listByProduct(p1.id)) {
          row.title = "changed";
        }
        (await repo.settings.get()).importTax.vatBasisPoints = 0;
        expect(await repo.listings.listByProduct(p1.id)).toEqual([listing("l1", p1.id, url("one"))]);
        expect((await repo.settings.get()).importTax.vatBasisPoints).toBe(DEFAULT_SETTINGS.importTax.vatBasisPoints);
      });
    });

    describe("Price snapshots", () => {
      beforeEach(seed);

      it("returns a listing's snapshots observed at or after an instant to the millisecond, oldest first", async () => {
        const unknownShipping = { ...snapshot("s5", l1.id, JAN_3), shipping: ShippingUnknown, shipTo: "US" as const };
        const atJan2 = snapshot("s4", l1.id, JAN_2);
        for (const row of [unknownShipping, snapshot("s3", l1.id, JUST_BEFORE_JAN_2), atJan2]) {
          expect(await repo.snapshots.append(row)).toEqual(ok);
        }
        await repo.snapshots.append(snapshot("s6", l2.id, JAN_2));
        expect(await repo.snapshots.listSince(l1.id, JAN_2)).toEqual([atJan2, unknownShipping]);
      });

      it("picks the snapshot with the greater id by code point when two share an observed instant", async () => {
        for (const id of ["s4", "s5", "s3"]) {
          await repo.snapshots.append(snapshot(id, l1.id, JAN_2));
        }
        expect(await repo.snapshots.latestPerListing(p1.id)).toEqual([snapshot("s5", l1.id, JAN_2)]);
      });

      it("picks the snapshot id outside the basic plane over one inside it on an observed instant tie", async () => {
        for (const id of [ASTRAL_ID_HIGH, ASTRAL_ID_LOW]) {
          await repo.snapshots.append(snapshot(id, l1.id, JAN_2));
        }
        expect(await repo.snapshots.latestPerListing(p1.id)).toEqual([snapshot(ASTRAL_ID_HIGH, l1.id, JAN_2)]);
      });

      it("refuses a snapshot for a listing that does not exist", async () => {
        expect(await repo.snapshots.append(snapshot("s3", missingListing, JAN_1))).toEqual(notFound);
      });

      it("rejects a snapshot id that is already stored as a bug", async () => {
        await expect(repo.snapshots.append(snapshot("s1", l1.id, JAN_2))).rejects.toThrow();
      });

      it("returns the latest snapshot of each of a product's listings", async () => {
        const l3 = listing("l3", p1.id, url("three"));
        const latest = [snapshot("s3", l1.id, JAN_2), snapshot("s4", l3.id, JAN_1)];
        await repo.listings.addWithSnapshot(l3, snapshot("s4", l3.id, JAN_1));
        for (const row of [snapshot("s3", l1.id, JAN_2), snapshot("s5", l2.id, JAN_3)]) {
          await repo.snapshots.append(row);
        }
        const found = await repo.snapshots.latestPerListing(p1.id);
        expect(found.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(latest);
      });
    });

    describe("Match candidates", () => {
      beforeEach(seed);

      it("lists candidate ids outside the basic plane after those inside it when similarity ties", async () => {
        const inside = candidate(ASTRAL_ID_LOW, p1.id, url("inside"), HIGH_SIMILARITY);
        const outside = candidate(ASTRAL_ID_HIGH, p1.id, url("outside"), HIGH_SIMILARITY);
        expect(await repo.matchCandidates.save([outside, inside])).toEqual(ok);
        expect(await repo.matchCandidates.listPending()).toEqual([inside, outside]);
      });

      it("lists pending candidates highest similarity first and leaves out decided ones", async () => {
        const low = candidate("c1", p1.id, url("c1"), LOW_SIMILARITY);
        const high = candidate("c2", p2.id, url("c2"), HIGH_SIMILARITY);
        const rejected = candidate("c3", p1.id, url("c3"), HIGH_SIMILARITY);
        const accepted = candidate("c4", p1.id, url("c4"), HIGH_SIMILARITY);
        expect(await repo.matchCandidates.save([low, high, rejected, accepted])).toEqual(ok);
        expect(await repo.matchCandidates.reject(rejected.id)).toEqual(ok);
        const l3 = listing("l3", p1.id, accepted.url);
        expect(await repo.matchCandidates.accept(accepted.id, l3, snapshot("s3", l3.id, JAN_2))).toEqual(ok);
        expect(await repo.matchCandidates.listPending()).toEqual([high, low]);
      });

      it("lists one product's pending candidates in the same order, leaving out others' and decided ones", async () => {
        const low = candidate("c1", p1.id, url("c1"), LOW_SIMILARITY);
        const high = candidate("c2", p1.id, url("c2"), HIGH_SIMILARITY);
        const other = candidate("c3", p2.id, url("c3"), HIGH_SIMILARITY);
        const rejected = candidate("c4", p1.id, url("c4"), HIGH_SIMILARITY);
        expect(await repo.matchCandidates.save([low, high, other, rejected])).toEqual(ok);
        expect(await repo.matchCandidates.reject(rejected.id)).toEqual(ok);
        expect(await repo.matchCandidates.listPendingFor(p1.id)).toEqual([high, low]);
        expect(await repo.matchCandidates.listPendingFor(missingProduct)).toEqual([]);
      });

      it("breaks similarity ties by candidate id, comparing ids by code point", async () => {
        const first = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const second = candidate("c2", p1.id, url("c2"), HIGH_SIMILARITY);
        const third = candidate("c3", p1.id, url("c3"), HIGH_SIMILARITY);
        expect(await repo.matchCandidates.save([third, first, second])).toEqual(ok);
        expect(await repo.matchCandidates.listPending()).toEqual([first, second, third]);
      });

      it("accepts a candidate by storing its listing and first snapshot in the same step", async () => {
        const found = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const matched = { ...listing("l3", p1.id, found.url), origin: ListingOrigin.Matched };
        const first = snapshot("s3", matched.id, JAN_2);
        await repo.matchCandidates.save([found]);
        expect(await repo.matchCandidates.accept(found.id, matched, first)).toEqual(ok);
        expect(await repo.listings.findByUrl(found.url)).toEqual(matched);
        expect(await repo.snapshots.listSince(matched.id, JAN_1)).toEqual([first]);
      });

      it("refuses accepting a tracked url, storing nothing and leaving the candidate pending", async () => {
        const found = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const tracked = listing("l3", p1.id, l2.url);
        await repo.matchCandidates.save([found]);
        expect(await repo.matchCandidates.accept(found.id, tracked, snapshot("s3", tracked.id, JAN_2))).toEqual(
          duplicateUrl,
        );
        expect(await repo.snapshots.listSince(tracked.id, JAN_1)).toEqual([]);
        expect(await repo.matchCandidates.listPending()).toEqual([found]);
      });

      it("refuses with not_found to accept a candidate of an archived product, leaving it pending", async () => {
        const found = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const matched = { ...listing("l3", p1.id, found.url), origin: ListingOrigin.Matched };
        await repo.matchCandidates.save([found]);
        await repo.products.archive(p1.id, JAN_2);
        expect(await repo.matchCandidates.accept(found.id, matched, snapshot("s3", matched.id, JAN_2))).toEqual(
          notFound,
        );
        expect(await repo.listings.findByUrl(found.url)).toBeNull();
        expect(await repo.matchCandidates.listPending()).toEqual([found]);
      });

      it("reports not_found when accepting or rejecting a candidate that does not exist", async () => {
        const missing = matchCandidateIdSchema.parse("missing");
        const l3 = listing("l3", p1.id, url("three"));
        expect(await repo.matchCandidates.accept(missing, l3, snapshot("s3", l3.id, JAN_2))).toEqual(notFound);
        expect(await repo.matchCandidates.reject(missing)).toEqual(notFound);
        expect(await repo.listings.findByUrl(l3.url)).toBeNull();
      });

      it("rejects accepting with a listing of another product or a snapshot of another listing as a bug", async () => {
        const found = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const foreign = listing("l3", p2.id, found.url);
        const own = listing("l3", p1.id, found.url);
        await repo.matchCandidates.save([found]);
        const foreignFirst = snapshot("s3", foreign.id, JAN_2);
        await expect(repo.matchCandidates.accept(found.id, foreign, foreignFirst)).rejects.toThrow();
        await expect(repo.matchCandidates.accept(found.id, own, snapshot("s3", l1.id, JAN_2))).rejects.toThrow();
        expect(await repo.listings.findByUrl(found.url)).toBeNull();
      });

      it("rejects accepting with a listing or snapshot id already stored as a bug", async () => {
        const found = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const reused = listing("l1", p1.id, found.url);
        const fresh = listing("l3", p1.id, found.url);
        await repo.matchCandidates.save([found]);
        const reusedFirst = snapshot("s3", reused.id, JAN_2);
        await expect(repo.matchCandidates.accept(found.id, reused, reusedFirst)).rejects.toThrow();
        await expect(repo.matchCandidates.accept(found.id, fresh, snapshot("s1", fresh.id, JAN_2))).rejects.toThrow();
        expect(await repo.matchCandidates.listPending()).toEqual([found]);
      });

      it("records a verdict on a candidate, replacing its earlier one", async () => {
        const found = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const judged = { verdict: LlmVerdict.Variant, reason: "Different battery size." };
        await repo.matchCandidates.save([found]);
        expect(await repo.matchCandidates.recordVerdict(found.id, judged)).toEqual(ok);
        expect(await repo.matchCandidates.listPending()).toEqual([
          { ...found, llmVerdict: judged.verdict, llmReason: judged.reason },
        ]);
      });

      it("reports not_found when recording a verdict on a candidate that does not exist", async () => {
        const judged = { verdict: LlmVerdict.Same, reason: "Same model." };
        expect(await repo.matchCandidates.recordVerdict(matchCandidateIdSchema.parse("missing"), judged)).toEqual(
          notFound,
        );
      });

      it("refuses with not_found to accept or reject a candidate already decided, storing nothing", async () => {
        const accepted = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        const rejected = candidate("c2", p1.id, url("c2"), HIGH_SIMILARITY);
        const l3 = listing("l3", p1.id, accepted.url);
        await repo.matchCandidates.save([accepted, rejected]);
        await repo.matchCandidates.accept(accepted.id, l3, snapshot("s3", l3.id, JAN_2));
        await repo.matchCandidates.reject(rejected.id);
        const again = listing("l4", p1.id, url("again"));
        const againFirst = snapshot("s4", again.id, JAN_2);
        expect(await repo.matchCandidates.accept(accepted.id, again, againFirst)).toEqual(notFound);
        const late = listing("l5", p1.id, rejected.url);
        expect(await repo.matchCandidates.accept(rejected.id, late, snapshot("s5", late.id, JAN_2))).toEqual(notFound);
        expect(await repo.matchCandidates.reject(accepted.id)).toEqual(notFound);
        expect(await repo.listings.listByProduct(p1.id)).toEqual([l1, l3]);
        expect(await repo.snapshots.listSince(late.id, JAN_1)).toEqual([]);
        expect(await repo.matchCandidates.isKnownUrl(p1.id, rejected.url)).toBe(true);
        expect(await repo.matchCandidates.listPending()).toEqual([]);
      });

      it("refuses with not_found to record a verdict on a candidate already decided", async () => {
        const rejected = candidate("c1", p1.id, url("c1"), HIGH_SIMILARITY);
        await repo.matchCandidates.save([rejected]);
        await repo.matchCandidates.reject(rejected.id);
        const judged = { verdict: LlmVerdict.Same, reason: "Same model." };
        expect(await repo.matchCandidates.recordVerdict(rejected.id, judged)).toEqual(notFound);
      });

      it("refuses a batch repeating a url already suggested for the same product and saves none of it", async () => {
        const first = candidate("c1", p1.id, url("c1"), LOW_SIMILARITY);
        await repo.matchCandidates.save([first]);
        const fresh = candidate("c2", p1.id, url("c2"), LOW_SIMILARITY);
        const again = candidate("c3", p1.id, url("c1"), HIGH_SIMILARITY);
        expect(await repo.matchCandidates.save([fresh, again])).toEqual(duplicateUrl);
        expect(await repo.matchCandidates.listPending()).toEqual([first]);
      });

      it("rejects a candidate for a product that does not exist, or with an id already stored, as a bug", async () => {
        await repo.matchCandidates.save([candidate("c1", p1.id, url("c1"), LOW_SIMILARITY)]);
        await expect(
          repo.matchCandidates.save([candidate("c2", missingProduct, url("c2"), LOW_SIMILARITY)]),
        ).rejects.toThrow();
        await expect(repo.matchCandidates.save([candidate("c1", p2.id, url("c3"), LOW_SIMILARITY)])).rejects.toThrow();
      });

      it("treats a url as known for a product once suggested for it, even if rejected", async () => {
        const rejected = candidate("c1", p1.id, url("c1"), LOW_SIMILARITY);
        await repo.matchCandidates.save([rejected]);
        await repo.matchCandidates.reject(rejected.id);
        expect(await repo.matchCandidates.isKnownUrl(p1.id, rejected.url)).toBe(true);
        expect(await repo.matchCandidates.isKnownUrl(p2.id, rejected.url)).toBe(false);
      });

      it("treats a url as known for every product once any listing tracks it", async () => {
        expect(await repo.matchCandidates.isKnownUrl(p1.id, l2.url)).toBe(true);
        expect(await repo.matchCandidates.isKnownUrl(p1.id, url("unknown"))).toBe(false);
      });
    });

    describe("LLM verdict cache", () => {
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

    describe("Alerts", () => {
      beforeEach(seed);

      it("lists alerts newest first to the millisecond, or only the unread ones when asked", async () => {
        const older = alert("a1", l1, JUST_BEFORE_JAN_2, s1.id);
        const newer = { ...alert("a2", l2, JAN_2, s2.id), beforeSnapshotId: s2.id };
        await repo.alerts.save(older);
        await repo.alerts.save(newer);
        expect(await repo.alerts.markRead(older.id, JAN_3)).toEqual(ok);
        expect(await repo.alerts.list({ unreadOnly: false })).toEqual([newer, { ...older, readAt: JAN_3 }]);
        expect(await repo.alerts.list({ unreadOnly: true })).toEqual([newer]);
      });

      it("lists alerts created at the same instant greater id first by code point", async () => {
        for (const id of ["a2", "a3", "a1"]) {
          await repo.alerts.save(alert(id, l1, JAN_2, s1.id));
        }
        const ids = (await repo.alerts.list({ unreadOnly: false })).map((row) => row.id);
        expect(ids).toEqual(["a3", "a2", "a1"]);
      });

      it("marks every unread alert read at one instant, says how many, and leaves read ones as they were", async () => {
        for (const id of ["a1", "a2", "a3"]) {
          await repo.alerts.save(alert(id, l1, JAN_1, s1.id));
        }
        expect(await repo.alerts.markRead(alertIdSchema.parse("a1"), JAN_2)).toEqual(ok);
        expect(await repo.alerts.markAllRead(JAN_3)).toBe(["a2", "a3"].length);
        const readAt = (await repo.alerts.list({ unreadOnly: false })).map((row) => [row.id, row.readAt]);
        expect(readAt).toEqual([["a3", JAN_3], ["a2", JAN_3], ["a1", JAN_2]]);
        expect(await repo.alerts.markAllRead(JAN_3)).toBe(0);
      });

      it("reports not_found when marking an alert read that does not exist", async () => {
        expect(await repo.alerts.markRead(alertIdSchema.parse("missing"), JAN_1)).toEqual(notFound);
      });

      it("rejects an alert referencing a missing product, listing or snapshot as a bug", async () => {
        const valid = alert("a1", l1, JAN_2, s1.id);
        const missingSnapshot = snapshotIdSchema.parse("missing");
        await expect(repo.alerts.save({ ...valid, productId: missingProduct })).rejects.toThrow();
        await expect(repo.alerts.save({ ...valid, listingId: missingListing })).rejects.toThrow();
        await expect(repo.alerts.save({ ...valid, afterSnapshotId: missingSnapshot })).rejects.toThrow();
        await expect(repo.alerts.save({ ...valid, beforeSnapshotId: missingSnapshot })).rejects.toThrow();
      });

      it("rejects an alert id that is already stored as a bug", async () => {
        await repo.alerts.save(alert("a1", l1, JAN_2, s1.id));
        await expect(repo.alerts.save(alert("a1", l2, JAN_3, s2.id))).rejects.toThrow();
      });
    });

    describe("Scan runs", () => {
      it("has no latest scan run before any scan ran", async () => {
        expect(await repo.scanRuns.latest()).toBeNull();
        expect(await repo.scanRuns.latest(PLUGIN)).toBeNull();
      });

      it("returns the most recently started scan run overall and per plugin", async () => {
        const blocked = {
          ...scanRun("r3", OTHER_PLUGIN, JAN_3),
          outcome: ScanOutcome.Blocked,
          errorKind: "blocked" as const,
        };
        for (const run of [scanRun("r2", PLUGIN, JAN_2), blocked, scanRun("r1", PLUGIN, JAN_1)]) {
          await repo.scanRuns.record(run);
        }
        expect(await repo.scanRuns.latest()).toEqual(blocked);
        expect(await repo.scanRuns.latest(PLUGIN)).toEqual(scanRun("r2", PLUGIN, JAN_2));
      });

      it("picks the run with the greater id by code point when two started at the same instant", async () => {
        for (const run of [scanRun("r2", PLUGIN, JAN_1), scanRun("r3", PLUGIN, JAN_1), scanRun("r1", PLUGIN, JAN_1)]) {
          await repo.scanRuns.record(run);
        }
        expect(await repo.scanRuns.latest(PLUGIN)).toEqual(scanRun("r3", PLUGIN, JAN_1));
      });

      it("picks the run id outside the basic plane over one inside it on a start instant tie", async () => {
        for (const id of [ASTRAL_ID_HIGH, ASTRAL_ID_LOW]) {
          await repo.scanRuns.record(scanRun(id, PLUGIN, JAN_1));
        }
        expect(await repo.scanRuns.latest(PLUGIN)).toEqual(scanRun(ASTRAL_ID_HIGH, PLUGIN, JAN_1));
      });

      it("rejects a scan run id that is already stored as a bug", async () => {
        await repo.scanRuns.record(scanRun("r1", PLUGIN, JAN_1));
        await expect(repo.scanRuns.record(scanRun("r1", OTHER_PLUGIN, JAN_2))).rejects.toThrow();
      });
    });

    describe("FX rates", () => {
      const table = (fetchedOn: string): FxTable => ({ base: "USD", ratesPerBase: { ILS: ILS_PER_USD }, fetchedOn });

      it("has no rates before any were saved", async () => {
        expect(await repo.fxRates.latest()).toBeNull();
      });

      it("returns the last saved rate table", async () => {
        await repo.fxRates.save(table("2026-01-01"));
        await repo.fxRates.save(table("2026-01-02"));
        expect(await repo.fxRates.latest()).toEqual(table("2026-01-02"));
      });

      it("returns the last saved table even when its date is older than an earlier one's", async () => {
        await repo.fxRates.save(table("2026-01-02"));
        await repo.fxRates.save(table("2026-01-01"));
        expect(await repo.fxRates.latest()).toEqual(table("2026-01-01"));
      });
    });

    describe("Plugin health", () => {
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

    describe("Settings", () => {
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
