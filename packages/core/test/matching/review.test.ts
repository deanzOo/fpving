import { StoreErrorKind } from "@fpving/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  acceptCandidate,
  AddErrorKind,
  addListing,
  DEFAULT_SETTINGS,
  err,
  findMatches,
  ListingOrigin,
  ListingStatus,
  listingIdSchema,
  matchCandidateIdSchema,
  MatchErrorKind,
  ok,
  pendingCandidates,
  productIdSchema,
  rejectCandidate,
  snapshotIdSchema,
} from "../../src/index.ts";
import type { MatchCandidate, Repository, StoreGateway } from "../../src/index.ts";
import { EXACT, fetched, NOW, setup, SHOP_A } from "./fixture.ts";

const EXACT_URL = "https://a.example/f60";
const notPending = err({ kind: MatchErrorKind.NotPending });
const missing = matchCandidateIdSchema.parse("missing");

const withCandidates = async (options: Parameters<typeof setup>[0] = {}) => {
  const context = await setup({ ...options, b: ok([]) });
  await findMatches(context.deps, context.productId);
  const [exact, older] = await context.repository.matchCandidates.listPending();
  if (exact === undefined || older === undefined) {
    throw new Error("expected two candidates");
  }
  return { ...context, exact, older };
};

const pendingIds = async (repository: Repository): Promise<string[]> =>
  (await repository.matchCandidates.listPending()).map((row: MatchCandidate) => row.id);

describe("Accepting a match candidate", () => {
  it("fetches the candidate and adds it as an active matched listing with a first snapshot", async () => {
    const { deps, repository, stores, productId, exact, older } = await withCandidates();
    const accepted = await acceptCandidate(deps, exact.id);
    const listing = {
      id: listingIdSchema.parse("id-6"),
      productId,
      pluginId: SHOP_A,
      url: EXACT_URL,
      title: EXACT.title,
      status: ListingStatus.Active,
      origin: ListingOrigin.Matched,
      addedAt: NOW,
      failureStreak: 0,
      notFoundStreak: 0,
    };
    const { itemPrice, shipping, inStock } = fetched(EXACT.title);
    const snapshot = {
      id: snapshotIdSchema.parse("id-7"),
      listingId: listing.id,
      observedAt: NOW,
      shipTo: DEFAULT_SETTINGS.shipToCountry,
      itemPrice,
      shipping,
      inStock,
    };
    expect(accepted).toEqual(ok({ listing, snapshot }));
    expect(stores.fetched.at(-1)).toBe(EXACT_URL);
    expect(await repository.listings.findByUrl(EXACT_URL)).toEqual(listing);
    expect(await repository.snapshots.listSince(listing.id, NOW)).toEqual([snapshot]);
    expect(await pendingIds(repository)).toEqual([older.id]);
  });

  it("quotes the first snapshot for the saved ship-to country", async () => {
    const { deps, repository, exact } = await withCandidates();
    await repository.settings.save({ ...(await repository.settings.get()), shipToCountry: "US" });
    const accepted = await acceptCandidate(deps, exact.id);
    expect(accepted.ok && accepted.value.snapshot.shipTo).toBe("US");
  });

  it("refuses a candidate that is not pending, without fetching", async () => {
    const { deps, repository, stores, exact, older } = await withCandidates();
    await acceptCandidate(deps, exact.id);
    await rejectCandidate(deps, older.id);
    const fetches = stores.fetched.length;
    expect(await acceptCandidate(deps, exact.id)).toEqual(notPending);
    expect(await acceptCandidate(deps, older.id)).toEqual(notPending);
    expect(await acceptCandidate(deps, missing)).toEqual(notPending);
    expect(stores.fetched).toHaveLength(fetches);
    expect(await pendingIds(repository)).toEqual([]);
  });

  it("passes the store error through and leaves the candidate pending when the fetch fails", async () => {
    const blocked = { kind: StoreErrorKind.Blocked, detail: "captcha" } as const;
    const { deps, repository, exact, older } = await withCandidates({ aListing: err(blocked) });
    expect(await acceptCandidate(deps, exact.id)).toEqual(err({ kind: AddErrorKind.FetchFailed, error: blocked }));
    expect(await pendingIds(repository)).toEqual([exact.id, older.id]);
  });

  it("returns the listing tracking the url when it was added meanwhile, leaving the candidate pending", async () => {
    const { deps, repository, productId, exact, older } = await withCandidates();
    const added = await addListing(deps, productId, EXACT_URL);
    const tracking = added.ok ? added.value.listing : undefined;
    const alreadyTracked = err({ kind: AddErrorKind.AlreadyTracked, listing: tracking });
    expect(await acceptCandidate(deps, exact.id)).toEqual(alreadyTracked);
    expect(await pendingIds(repository)).toEqual([exact.id, older.id]);
  });

  it("refuses a candidate rejected while its page was being fetched, storing no listing", async () => {
    const { deps, repository, exact } = await withCandidates();
    const stores: StoreGateway = {
      ...deps.stores,
      fetchListing: async (pluginId, url) => {
        await repository.matchCandidates.reject(exact.id);
        return deps.stores.fetchListing(pluginId, url);
      },
    };
    expect(await acceptCandidate({ ...deps, stores }, exact.id)).toEqual(notPending);
    expect(await repository.listings.findByUrl(EXACT_URL)).toBeNull();
  });
});

describe("Rejecting a match candidate", () => {
  it("marks a pending candidate rejected so its url is never suggested for the product again", async () => {
    const { deps, repository, productId, exact, older } = await withCandidates();
    expect(await rejectCandidate(deps, exact.id)).toEqual(ok(undefined));
    expect(await pendingIds(repository)).toEqual([older.id]);
    expect(await repository.matchCandidates.isKnownUrl(productId, EXACT_URL)).toBe(true);
  });

  it("refuses a candidate that is not pending", async () => {
    const { deps, exact } = await withCandidates();
    await rejectCandidate(deps, exact.id);
    expect(await rejectCandidate(deps, exact.id)).toEqual(notPending);
    expect(await rejectCandidate(deps, missing)).toEqual(notPending);
  });
});

describe("Listing a product's pending candidates", () => {
  it("lists the product's pending candidates, highest similarity first", async () => {
    const { deps, productId, exact, older } = await withCandidates();
    await rejectCandidate(deps, older.id);
    expect(await pendingCandidates(deps, productId)).toEqual(ok([exact]));
  });

  it("answers product_not_found for a product that does not exist", async () => {
    const { deps } = await withCandidates();
    const result = await pendingCandidates(deps, productIdSchema.parse("missing"));
    expect(result).toEqual(err({ kind: AddErrorKind.ProductNotFound }));
  });
});
