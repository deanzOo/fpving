import { err, ok } from "@fpving/plugin-sdk";
import type { Clock, FetchedListing, Result, StoreError } from "@fpving/plugin-sdk";
import { ListingOrigin, ListingStatus } from "../entities.js";
import type { Listing, PriceSnapshot, Product } from "../entities.js";
import { listingIdSchema, productIdSchema, snapshotIdSchema } from "../ids.js";
import type { PluginId, ProductId } from "../ids.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { Repository } from "../ports/repository.js";
import { RepositoryErrorKind } from "../ports/repository.js";
import type { StoreGateway } from "../ports/store-gateway.js";
import { AddErrorKind } from "./errors.js";
import { normalizeListingUrl } from "./normalize-url.js";
import type { InvalidUrl } from "./normalize-url.js";

/** The ports every core use case builds on: storage, the store gateway, ids and the clock. */
export interface CoreDeps {
  /** Where the product, listing and snapshot are stored. */
  readonly repository: Repository;
  /** Resolves the plugin for a URL and fetches the listing. */
  readonly stores: StoreGateway;
  /** Mints the new entity ids. */
  readonly ids: IdGenerator;
  /** Stamps `createdAt`, `addedAt` and `observedAt`. */
  readonly clock: Clock;
}

/** No loaded plugin declares `host`, the normalized URL's hostname. */
export interface NoPluginForDomain {
  readonly kind: typeof AddErrorKind.NoPluginForDomain;
  readonly host: string;
}

/** A listing already tracks the normalized URL; `listing` is that listing, and `product` its product. */
export interface AlreadyTracked {
  readonly kind: typeof AddErrorKind.AlreadyTracked;
  readonly listing: Listing;
  readonly product: Product;
}

/** The store plugin could not fetch the listing; `error` is the store's error, unchanged. */
export interface FetchFailed {
  readonly kind: typeof AddErrorKind.FetchFailed;
  readonly error: StoreError;
}

/** The product the operation is about does not exist. */
export interface ProductNotFound {
  readonly kind: typeof AddErrorKind.ProductNotFound;
}

/** Why {@link addProduct} stored nothing. */
export type AddProductError = InvalidUrl | NoPluginForDomain | AlreadyTracked | FetchFailed;

/** Why {@link addListing} stored nothing: an {@link AddProductError}, or `product_not_found` for an unknown product. */
export type AddListingError = AddProductError | ProductNotFound;

/** What {@link addListing} stored. */
export interface AddedListing {
  /** The new listing: active, `manual`, with no failures. */
  readonly listing: Listing;
  /** Its first snapshot, quoted for the saved ship-to country. */
  readonly snapshot: PriceSnapshot;
}

/** What {@link addProduct} stored, everything assisted matching needs to start. */
export interface AddedProduct extends AddedListing {
  /** The new product, named after the listing title. */
  readonly product: Product;
}

/** A fetched store page about to become a listing. */
export interface Target {
  readonly url: string;
  readonly pluginId: PluginId;
  readonly fetched: FetchedListing;
}

/** The product with id `id` unless it is missing or archived, in which case it counts as gone: null. */
export const liveProduct = async (repository: Repository, id: ProductId): Promise<Product | null> => {
  const product = await repository.products.get(id);
  return product?.archivedAt === null ? product : null;
};

const ACTIVE = { status: ListingStatus.Active, failureStreak: 0, notFoundStreak: 0 } as const;

const ownerOf = async (repository: Repository, listing: Listing): Promise<Product> => {
  const product = await repository.products.get(listing.productId);
  if (product === null) {
    throw new Error(`the product of the listing tracking ${listing.url} is missing`);
  }
  return product;
};

const trackedBy = async (repository: Repository, listing: Listing): Promise<Result<never, AlreadyTracked>> =>
  err({ kind: AddErrorKind.AlreadyTracked, listing, product: await ownerOf(repository, listing) });

/** The `already_tracked` error for a url the repository refused as tracked, naming the listing tracking it. */
export const alreadyTracked = async (repository: Repository, url: string): Promise<Result<never, AlreadyTracked>> => {
  const listing = await repository.listings.findByUrl(url);
  if (listing === null) {
    throw new Error(`the repository reported ${url} as tracked but has no listing for it`);
  }
  return trackedBy(repository, listing);
};

type Resolved = Pick<Target, "url" | "pluginId">;

const resolve = ({ stores }: CoreDeps, input: string): Result<Resolved, InvalidUrl | NoPluginForDomain> => {
  const normalized = normalizeListingUrl(input, stores.declaredDomains());
  if (!normalized.ok) {
    return normalized;
  }
  const url = normalized.value;
  const pluginId = stores.pluginFor(url);
  return pluginId === null
    ? err({ kind: AddErrorKind.NoPluginForDomain, host: new URL(url).hostname })
    : ok({ url, pluginId });
};

const fetchTarget = async ({ stores }: CoreDeps, { url, pluginId }: Resolved): Promise<Result<Target, FetchFailed>> => {
  const fetched = await stores.fetchListing(pluginId, url);
  return fetched.ok
    ? ok({ url, pluginId, fetched: fetched.value })
    : err({ kind: AddErrorKind.FetchFailed, error: fetched.error });
};

const firstSnapshot = async (deps: CoreDeps, listing: Listing, target: Target, now: Date): Promise<PriceSnapshot> => {
  const { shipToCountry } = await deps.repository.settings.get();
  const { itemPrice, shipping, inStock } = target.fetched;
  return {
    id: snapshotIdSchema.parse(deps.ids.next()),
    listingId: listing.id,
    observedAt: now,
    shipTo: shipToCountry,
    itemPrice,
    shipping,
    inStock,
  };
};

const refetched = async (
  deps: CoreDeps,
  resolved: Resolved,
  listing: Listing,
): Promise<Result<AddedListing, FetchFailed>> => {
  const target = await fetchTarget(deps, resolved);
  if (!target.ok) {
    return target;
  }
  const snapshot = await firstSnapshot(deps, listing, target.value, deps.clock.now());
  return ok({ listing: { ...listing, ...ACTIVE }, snapshot });
};

/** An active listing of `target` with no failures and its first snapshot, quoted for the saved ship-to country. */
export const newListing = async (
  deps: CoreDeps,
  productId: ProductId,
  target: Target,
  origin: ListingOrigin,
  now: Date,
): Promise<AddedListing> => {
  const listing: Listing = {
    id: listingIdSchema.parse(deps.ids.next()),
    productId,
    pluginId: target.pluginId,
    url: target.url,
    title: target.fetched.title,
    origin,
    addedAt: now,
    ...ACTIVE,
  };
  return { listing, snapshot: await firstSnapshot(deps, listing, target, now) };
};

const restoreProduct = async (
  deps: CoreDeps,
  resolved: Resolved,
  tracked: Listing,
): Promise<Result<AddedProduct, AddProductError>> => {
  const { repository } = deps;
  const product = await ownerOf(repository, tracked);
  if (product.archivedAt === null) {
    return err({ kind: AddErrorKind.AlreadyTracked, listing: tracked, product });
  }
  const added = await refetched(deps, resolved, tracked);
  if (!added.ok) {
    return added;
  }
  const restored = await repository.products.restore(product.id, added.value.snapshot);
  return restored.ok
    ? ok({ ...added.value, product: { ...product, archivedAt: null } })
    : alreadyTracked(repository, resolved.url);
};

/**
 * Starts watching the product behind a pasted store URL: stores a product named after the listing title, its first
 * listing and its first snapshot, all or nothing.
 *
 * @remarks
 * The URL is normalized with {@link normalizeListingUrl} first. The URL of a listing of an archived product restores
 * that product: the listing is fetched again, made active with no failures and given a new snapshot, and the product
 * is un-archived with its history. Any other URL a listing already tracks is never fetched and stores nothing: it
 * yields `already_tracked` with that listing and its product, also when another add stores or restores the URL while
 * this one is fetching. An `ok` result means a new or restored product, for which assisted matching can start.
 *
 * @param deps - The ports to use.
 * @param url - The URL as the user pasted it.
 * @returns What was stored, or why nothing was.
 */
export const addProduct = async (deps: CoreDeps, url: string): Promise<Result<AddedProduct, AddProductError>> => {
  const resolved = resolve(deps, url);
  if (!resolved.ok) {
    return resolved;
  }
  const tracked = await deps.repository.listings.findByUrl(resolved.value.url);
  if (tracked !== null) {
    return restoreProduct(deps, resolved.value, tracked);
  }
  const target = await fetchTarget(deps, resolved.value);
  if (!target.ok) {
    return target;
  }
  const now = deps.clock.now();
  const product: Product = {
    id: productIdSchema.parse(deps.ids.next()),
    name: target.value.fetched.title,
    createdAt: now,
    archivedAt: null,
    cheapestListingId: null,
  };
  const { listing, snapshot } = await newListing(deps, product.id, target.value, ListingOrigin.Manual, now);
  const stored = await deps.repository.products.add(product, listing, snapshot);
  return stored.ok ? ok({ product, listing, snapshot }) : alreadyTracked(deps.repository, listing.url);
};

const restoreListing = async (
  deps: CoreDeps,
  productId: ProductId,
  resolved: Resolved,
  tracked: Listing,
): Promise<Result<AddedListing, AddListingError>> => {
  const { repository } = deps;
  if (tracked.productId !== productId || tracked.status !== ListingStatus.Removed) {
    return trackedBy(repository, tracked);
  }
  const added = await refetched(deps, resolved, tracked);
  if (!added.ok) {
    return added;
  }
  if ((await repository.listings.restore(productId, added.value.snapshot)).ok) {
    return added;
  }
  return (await liveProduct(repository, productId)) === null
    ? err({ kind: AddErrorKind.ProductNotFound })
    : alreadyTracked(repository, resolved.url);
};

/**
 * Adds a pasted store URL to an existing product as a `manual` listing with its first snapshot, both or neither.
 *
 * @remarks
 * Normalizes, resolves the plugin, dedupes and fetches exactly like {@link addProduct}. The URL of a removed listing
 * of this product makes it active again with no failures and a new snapshot, keeping its history; a URL any other
 * listing tracks yields `already_tracked`. The product is checked when the listing is stored, after the fetch, so an
 * unknown or archived product yields `product_not_found` and stores nothing.
 *
 * @param deps - The ports to use.
 * @param productId - The product the listing belongs to.
 * @param url - The URL as the user pasted it.
 * @returns What was stored, or why nothing was.
 */
export const addListing = async (
  deps: CoreDeps,
  productId: ProductId,
  url: string,
): Promise<Result<AddedListing, AddListingError>> => {
  const resolved = resolve(deps, url);
  if (!resolved.ok) {
    return resolved;
  }
  const tracked = await deps.repository.listings.findByUrl(resolved.value.url);
  if (tracked !== null) {
    return restoreListing(deps, productId, resolved.value, tracked);
  }
  const target = await fetchTarget(deps, resolved.value);
  if (!target.ok) {
    return target;
  }
  const added = await newListing(deps, productId, target.value, ListingOrigin.Manual, deps.clock.now());
  const stored = await deps.repository.listings.addWithSnapshot(added.listing, added.snapshot);
  if (stored.ok) {
    return ok(added);
  }
  if (stored.error.kind === RepositoryErrorKind.NotFound) {
    return err({ kind: AddErrorKind.ProductNotFound });
  }
  return alreadyTracked(deps.repository, added.listing.url);
};
