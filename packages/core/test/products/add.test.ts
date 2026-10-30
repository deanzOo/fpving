import { ShippingKind, StoreErrorKind } from "@fpving/plugin-sdk";
import type { FetchedListing, StoreResult } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  AddErrorKind,
  addListing,
  addProduct,
  DEFAULT_SETTINGS,
  err,
  ListingOrigin,
  ListingStatus,
  listingIdSchema,
  ok,
  pluginIdSchema,
  productIdSchema,
  snapshotIdSchema,
} from "../../src/index.ts";
import type { CoreDeps, Repository } from "../../src/index.ts";
import { fakeClock } from "../fakes/fake-clock.ts";
import { fakeIdGenerator } from "../fakes/fake-id-generator.ts";
import { inMemoryRepository } from "../fakes/in-memory-repository.ts";
import { fakeStoreGateway } from "../fakes/fake-store-gateway.ts";

const PRICE = 4999;
const SHIPPING = 700;
const SHOP = pluginIdSchema.parse("example-shop");
const NOW = new Date("2026-10-27T10:00:00.000Z");
const PASTED = "https://M.Shop.example/motor/?utm_source=forum&color=black#reviews";
const CANONICAL = "https://shop.example/motor?color=black";
const OTHER = "https://www.shop.example/frame/";
const OTHER_CANONICAL = "https://shop.example/frame";

const fetched: FetchedListing = {
  title: "T-Motor F60 Pro V 2207",
  itemPrice: { amountMinor: PRICE, currency: "USD" },
  shipping: { kind: ShippingKind.Known, amountMinor: SHIPPING, currency: "USD" },
  inStock: true,
  images: [],
};
const blocked = { kind: StoreErrorKind.Blocked, detail: "captcha" } as const;

const setup = (answer: StoreResult<FetchedListing> = ok(fetched), onFetch?: () => Promise<void>) => {
  const repository = inMemoryRepository();
  const stores = fakeStoreGateway([{ id: SHOP, domains: ["shop.example"], listing: answer }], onFetch);
  const deps: CoreDeps = { repository, stores, ids: fakeIdGenerator(), clock: fakeClock(NOW) };
  return { deps, repository, stores };
};

const expectedListing = (id: string, productId: string, url: string) => ({
  id: listingIdSchema.parse(id),
  productId: productIdSchema.parse(productId),
  pluginId: SHOP,
  url,
  title: fetched.title,
  status: ListingStatus.Active,
  origin: ListingOrigin.Manual,
  addedAt: NOW,
  failureStreak: 0,
  notFoundStreak: 0,
});

const expectedSnapshot = (id: string, listingId: string) => ({
  id: snapshotIdSchema.parse(id),
  listingId: listingIdSchema.parse(listingId),
  observedAt: NOW,
  shipTo: DEFAULT_SETTINGS.shipToCountry,
  itemPrice: fetched.itemPrice,
  shipping: fetched.shipping,
  inStock: true,
});

const forgetfulAboutUrls = (repository: Repository): Repository => ({
  ...repository,
  listings: { ...repository.listings, findByUrl: async () => Promise.resolve(null) },
});

describe("Adding a product", () => {
  it("stores a product named after the listing title with an active manual listing and a first snapshot", async () => {
    const { deps, repository } = setup();
    const id = productIdSchema.parse("id-1");
    const product = { id, name: fetched.title, createdAt: NOW, archivedAt: null, cheapestListingId: null };
    const listing = expectedListing("id-2", "id-1", CANONICAL);
    const snapshot = expectedSnapshot("id-3", "id-2");
    expect(await addProduct(deps, PASTED)).toEqual(ok({ product, listing, snapshot }));
    expect(await repository.listings.findByUrl(CANONICAL)).toEqual(listing);
    expect(await repository.snapshots.listSince(listing.id, NOW)).toEqual([snapshot]);
  });

  it("fetches the normalized URL through the plugin that declares its host", async () => {
    const { deps, stores } = setup();
    await addProduct(deps, PASTED);
    expect(stores.fetched).toEqual([CANONICAL]);
  });

  it("quotes the first snapshot for the saved ship-to country", async () => {
    const { deps, repository } = setup();
    await repository.settings.save({ ...structuredClone(DEFAULT_SETTINGS), shipToCountry: "US" });
    const added = await addProduct(deps, PASTED);
    expect(added.ok && added.value.snapshot.shipTo).toBe("US");
  });

  it("returns the existing listing when the URL is already tracked, without fetching", async () => {
    const { deps, stores } = setup();
    await addProduct(deps, PASTED);
    const again = await addProduct(deps, `${CANONICAL}&utm_medium=email`);
    const existing = expectedListing("id-2", "id-1", CANONICAL);
    expect(again).toEqual(err({ kind: AddErrorKind.AlreadyTracked, listing: existing }));
    expect(stores.fetched).toEqual([CANONICAL]);
  });

  it("refuses a URL whose host no plugin declares, naming the host, without fetching", async () => {
    const { deps, stores } = setup();
    expect(await addProduct(deps, "https://Unknown.example/motor")).toEqual(
      err({ kind: AddErrorKind.NoPluginForDomain, host: "unknown.example" }),
    );
    expect(stores.fetched).toEqual([]);
  });

  it("refuses an input that is not an http or https URL, without fetching", async () => {
    const { deps, stores } = setup();
    expect(await addProduct(deps, "shop.example/motor")).toEqual(err({ kind: AddErrorKind.InvalidUrl }));
    expect(stores.fetched).toEqual([]);
  });

  it("passes the store error through and stores nothing when the fetch fails", async () => {
    const { deps, repository } = setup(err(blocked));
    expect(await addProduct(deps, PASTED)).toEqual(err({ kind: AddErrorKind.FetchFailed, error: blocked }));
    expect(await repository.listings.findByUrl(CANONICAL)).toBeNull();
  });

  it("returns the listing that tracked the URL first when another add wins the race during the fetch", async () => {
    let raced = false;
    const racing = setup(ok(fetched), async () => {
      if (!raced) {
        raced = true;
        await addProduct(racing.deps, CANONICAL);
      }
    });
    expect(await addProduct(racing.deps, PASTED)).toEqual(
      err({ kind: AddErrorKind.AlreadyTracked, listing: expectedListing("id-2", "id-1", CANONICAL) }),
    );
  });

  it("rejects as a bug when the repository reports a tracked URL it cannot find", async () => {
    const { deps } = setup();
    await addProduct(deps, PASTED);
    const forgetful = { ...deps, repository: forgetfulAboutUrls(deps.repository) };
    await expect(addProduct(forgetful, PASTED)).rejects.toThrow();
  });
});

describe("Adding a listing to a product", () => {
  const withProduct = async (answer: StoreResult<FetchedListing> = ok(fetched)) => {
    const context = setup();
    await addProduct(context.deps, PASTED);
    const stores = fakeStoreGateway([{ id: SHOP, domains: ["shop.example"], listing: answer }]);
    return { ...context, deps: { ...context.deps, stores }, stores };
  };
  const productId = productIdSchema.parse("id-1");

  it("adds an active manual listing with its first snapshot to the product", async () => {
    const { deps, repository, stores } = await withProduct();
    const listing = expectedListing("id-4", "id-1", OTHER_CANONICAL);
    const snapshot = expectedSnapshot("id-5", "id-4");
    expect(await addListing(deps, productId, OTHER)).toEqual(ok({ listing, snapshot }));
    expect(stores.fetched).toEqual([OTHER_CANONICAL]);
    expect(await repository.listings.listByProduct(productId)).toEqual([
      expectedListing("id-2", "id-1", CANONICAL),
      listing,
    ]);
    expect(await repository.snapshots.listSince(listing.id, NOW)).toEqual([snapshot]);
  });

  it("returns the existing listing when the URL is already tracked, without fetching", async () => {
    const { deps, stores } = await withProduct();
    expect(await addListing(deps, productId, PASTED)).toEqual(
      err({ kind: AddErrorKind.AlreadyTracked, listing: expectedListing("id-2", "id-1", CANONICAL) }),
    );
    expect(stores.fetched).toEqual([]);
  });

  it("refuses an invalid URL or one whose host no plugin declares, without fetching", async () => {
    const { deps, stores } = await withProduct();
    expect(await addListing(deps, productId, "ftp://shop.example/frame")).toEqual(
      err({ kind: AddErrorKind.InvalidUrl }),
    );
    expect(await addListing(deps, productId, "https://unknown.example/frame")).toEqual(
      err({ kind: AddErrorKind.NoPluginForDomain, host: "unknown.example" }),
    );
    expect(stores.fetched).toEqual([]);
  });

  it("passes the store error through and stores nothing when the fetch fails", async () => {
    const { deps, repository } = await withProduct(err(blocked));
    expect(await addListing(deps, productId, OTHER)).toEqual(err({ kind: AddErrorKind.FetchFailed, error: blocked }));
    expect(await repository.listings.findByUrl(OTHER_CANONICAL)).toBeNull();
  });

  it("reports product_not_found and stores nothing when the product does not exist", async () => {
    const { deps, repository } = setup();
    expect(await addListing(deps, productIdSchema.parse("missing"), OTHER)).toEqual(
      err({ kind: AddErrorKind.ProductNotFound }),
    );
    expect(await repository.listings.findByUrl(OTHER_CANONICAL)).toBeNull();
  });

  it("reports product_not_found and stores nothing when the product is archived", async () => {
    const { deps, repository } = await withProduct();
    await repository.products.archive(productId, NOW);
    expect(await addListing(deps, productId, OTHER)).toEqual(err({ kind: AddErrorKind.ProductNotFound }));
    expect(await repository.listings.findByUrl(OTHER_CANONICAL)).toBeNull();
  });

  it("returns the listing that tracked the URL first when another add wins the race during the fetch", async () => {
    let armed = false;
    const racing = setup(ok(fetched), async () => {
      if (armed) {
        armed = false;
        await addProduct(racing.deps, OTHER);
      }
    });
    await addProduct(racing.deps, PASTED);
    armed = true;
    expect(await addListing(racing.deps, productId, OTHER)).toEqual(
      err({ kind: AddErrorKind.AlreadyTracked, listing: expectedListing("id-5", "id-4", OTHER_CANONICAL) }),
    );
  });
});
