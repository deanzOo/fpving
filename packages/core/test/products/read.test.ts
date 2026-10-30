import { ShippingKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  AddErrorKind,
  DEFAULT_SETTINGS,
  err,
  landedCost,
  listingIdSchema,
  ListingStatus,
  removeListing,
  RepositoryErrorKind,
  productDetail,
  productIdSchema,
  settingsSchema,
  watchlist,
} from "../../src/index.ts";
import type { Listing, PriceSnapshot, Product, Repository } from "../../src/index.ts";
import { daysAgo, listing, NOW, rates, snapshot } from "../alerts/builders.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";

const CHEAP = 5000;
const DEAR = 9000;
const OLDER_DAYS = 2;
const settings = settingsSchema.parse(DEFAULT_SETTINGS);

const product = (id: string, createdAt: Date): Product => ({
  id: productIdSchema.parse(id),
  name: `Product ${id}`,
  createdAt,
  archivedAt: null,
  cheapestListingId: null,
});

const price = (amountMinor: number): Partial<PriceSnapshot> => ({ itemPrice: { amountMinor, currency: "USD" } });

const watched = async (
  repository: Repository,
  row: Product,
  listings: readonly (readonly [Listing, PriceSnapshot])[],
): Promise<void> => {
  const [head, ...rest] = listings.map(([l, s]): [Listing, PriceSnapshot] => [{ ...l, productId: row.id }, s]);
  if (head === undefined) {
    throw new Error("a product needs a listing");
  }
  await repository.products.add(row, ...head);
  for (const [l, s] of rest) {
    await repository.listings.addWithSnapshot(l, s);
  }
};

const landed = (row: PriceSnapshot) => {
  const cost = landedCost(row, settings, rates);
  if (!cost.ok) {
    throw new Error("the snapshot cannot be priced");
  }
  return cost.value;
};

const withRates = async (): Promise<Repository> => {
  const repository = inMemoryRepository();
  await repository.fxRates.save(rates);
  return repository;
};

describe("The watchlist", () => {
  it("lists the products that are not archived newest first, each with its cheapest landed price", async () => {
    const repository = await withRates();
    const cheap = snapshot("s1", "l1", price(CHEAP));
    await watched(repository, product("p1", daysAgo(OLDER_DAYS)), [
      [listing("l2"), snapshot("s2", "l2", price(DEAR))],
      [listing("l1"), cheap],
    ]);
    const only = snapshot("s3", "l3", price(DEAR));
    await watched(repository, product("p2", daysAgo(1)), [[listing("l3"), only]]);
    await watched(repository, product("p3", NOW), [[listing("l4"), snapshot("s4", "l4")]]);
    await repository.products.archive(productIdSchema.parse("p3"), NOW);
    const entries = await watchlist({ repository });
    expect(entries.map(({ product: row, cheapest }) => [row.id, cheapest])).toEqual([
      ["p2", { listingId: "l3", landedCost: landed(only) }],
      ["p1", { listingId: "l1", landedCost: landed(cheap) }],
    ]);
  });

  it("prices only active, in-stock listings quoted for the ship-to country with known shipping", async () => {
    const repository = await withRates();
    const priced = snapshot("s1", "l1", price(DEAR));
    await watched(repository, product("p1", NOW), [
      [listing("l1"), priced],
      [listing("l2", { status: ListingStatus.Stale }), snapshot("s2", "l2", price(CHEAP))],
      [listing("l3"), snapshot("s3", "l3", { ...price(CHEAP), inStock: false })],
      [listing("l4"), snapshot("s4", "l4", { ...price(CHEAP), shipTo: "US" })],
      [listing("l5"), snapshot("s5", "l5", { ...price(CHEAP), shipping: { kind: ShippingKind.Unknown } })],
      [listing("l6"), snapshot("s6", "l6", { itemPrice: { amountMinor: CHEAP, currency: "JPY" } })],
    ]);
    const expected = { listingId: "l1", landedCost: landed(priced) };
    expect(await watchlist({ repository })).toMatchObject([{ cheapest: expected }]);
  });

  it("has no cheapest price for a product none of whose listings can be priced", async () => {
    const repository = await withRates();
    await watched(repository, product("p1", NOW), [[listing("l1"), snapshot("s1", "l1", { inStock: false })]]);
    expect(await watchlist({ repository })).toMatchObject([{ cheapest: null }]);
  });

  it("has no cheapest price for a product before any exchange rates were fetched", async () => {
    const repository = inMemoryRepository();
    await watched(repository, product("p1", NOW), [[listing("l1"), snapshot("s1", "l1")]]);
    expect(await watchlist({ repository })).toMatchObject([{ cheapest: null }]);
  });
});

describe("A product's detail", () => {
  it("has the product's listings oldest first, each with every snapshot oldest first", async () => {
    const repository = inMemoryRepository();
    const first = snapshot("s1", "l1", { observedAt: daysAgo(OLDER_DAYS) });
    const second = snapshot("s2", "l2");
    const row = product("p1", NOW);
    await watched(repository, row, [[listing("l1"), first], [listing("l2", { addedAt: NOW }), second]]);
    const later = snapshot("s3", "l1", { observedAt: NOW });
    await repository.snapshots.append(later);
    const detail = await productDetail({ repository }, row.id);
    expect(detail.ok && detail.value.listings.map(({ listing: l, history }) => [l.id, history.map((s) => s.id)]))
      .toEqual([["l1", ["s1", "s3"]], ["l2", ["s2"]]]);
    expect(detail.ok && detail.value.product).toEqual(row);
  });

  it("leaves removed listings out", async () => {
    const repository = inMemoryRepository();
    const row = product("p1", NOW);
    await watched(repository, row, [[listing("l1"), snapshot("s1", "l1")], [listing("l2"), snapshot("s2", "l2")]]);
    await repository.listings.remove(row.id, listingIdSchema.parse("l1"));
    const detail = await productDetail({ repository }, row.id);
    expect(detail.ok && detail.value.listings.map(({ listing: l }) => l.id)).toEqual(["l2"]);
  });

  it("answers product_not_found for a product that is missing or archived", async () => {
    const repository = inMemoryRepository();
    const row = product("p1", NOW);
    await watched(repository, row, [[listing("l1"), snapshot("s1", "l1")]]);
    await repository.products.archive(row.id, NOW);
    const notFound = err({ kind: AddErrorKind.ProductNotFound });
    expect(await productDetail({ repository }, row.id)).toEqual(notFound);
    expect(await productDetail({ repository }, productIdSchema.parse("missing"))).toEqual(notFound);
  });
});

describe("Removing a listing", () => {
  const twoListings = async () => {
    const repository = inMemoryRepository();
    const row = product("p1", NOW);
    await watched(repository, row, [[listing("l1"), snapshot("s1", "l1")], [listing("l2"), snapshot("s2", "l2")]]);
    return { repository, row };
  };
  const l1 = listingIdSchema.parse("l1");

  it("marks the product's listing removed, keeping the others", async () => {
    const { repository, row } = await twoListings();
    expect((await removeListing({ repository }, row.id, l1)).ok).toBe(true);
    const statuses = (await repository.listings.listByProduct(row.id)).map(({ id, status }) => [id, status]);
    expect(statuses).toEqual([["l1", ListingStatus.Removed], ["l2", ListingStatus.Active]]);
  });

  it("answers product_not_found for a product that is missing or archived, removing nothing", async () => {
    const { repository, row } = await twoListings();
    await repository.products.archive(row.id, NOW);
    const notFound = err({ kind: AddErrorKind.ProductNotFound });
    expect(await removeListing({ repository }, row.id, l1)).toEqual(notFound);
    expect(await removeListing({ repository }, productIdSchema.parse("missing"), l1)).toEqual(notFound);
    expect((await repository.listings.listByProduct(row.id)).map(({ status }) => status))
      .toEqual([ListingStatus.Active, ListingStatus.Active]);
  });

  it("answers not_found for a listing that is not the product's or already removed", async () => {
    const { repository, row } = await twoListings();
    await removeListing({ repository }, row.id, l1);
    const missing = err({ kind: RepositoryErrorKind.NotFound });
    expect(await removeListing({ repository }, row.id, l1)).toEqual(missing);
    expect(await removeListing({ repository }, row.id, listingIdSchema.parse("other"))).toEqual(missing);
  });
});
