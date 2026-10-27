import { err, ok } from "@fpving/plugin-sdk";
import type { Clock, FetchedListing, Result, StoreError } from "@fpving/plugin-sdk";
import { ListingOrigin, ListingStatus } from "../entities.js";
import type { Listing, PriceSnapshot, Product } from "../entities.js";
import { listingIdSchema, productIdSchema, snapshotIdSchema } from "../ids.js";
import type { PluginId, ProductId } from "../ids.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { NotFound, Repository } from "../ports/repository.js";
import { RepositoryErrorKind } from "../ports/repository.js";
import type { StoreGateway } from "../ports/store-gateway.js";
import { AddErrorKind } from "./errors.js";
import { normalizeListingUrl } from "./normalize-url.js";
import type { InvalidUrl } from "./normalize-url.js";

/** The ports adding a product or a listing uses. */
export interface AddDeps {
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

/** A listing already tracks the normalized URL; `listing` is that listing, and its `productId` its product. */
export interface AlreadyTracked {
  readonly kind: typeof AddErrorKind.AlreadyTracked;
  readonly listing: Listing;
}

/** The store plugin could not fetch the listing; `error` is the store's error, unchanged. */
export interface FetchFailed {
  readonly kind: typeof AddErrorKind.FetchFailed;
  readonly error: StoreError;
}

/** Why {@link addProduct} stored nothing. */
export type AddProductError = InvalidUrl | NoPluginForDomain | AlreadyTracked | FetchFailed;

/** Why {@link addListing} stored nothing: an {@link AddProductError}, or `not_found` for an unknown product. */
export type AddListingError = AddProductError | NotFound;

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

/** The `already_tracked` error for a url the repository refused as tracked, naming the listing tracking it. */
export const alreadyTracked = async (repository: Repository, url: string): Promise<Result<never, AlreadyTracked>> => {
  const listing = await repository.listings.findByUrl(url);
  if (listing === null) {
    throw new Error(`the repository reported ${url} as tracked but has no listing for it`);
  }
  return err({ kind: AddErrorKind.AlreadyTracked, listing });
};

const fetchNew = async ({ repository, stores }: AddDeps, input: string): Promise<Result<Target, AddProductError>> => {
  const normalized = normalizeListingUrl(input, stores.declaredDomains());
  if (!normalized.ok) {
    return normalized;
  }
  const url = normalized.value;
  const pluginId = stores.pluginFor(url);
  if (pluginId === null) {
    return err({ kind: AddErrorKind.NoPluginForDomain, host: new URL(url).hostname });
  }
  if ((await repository.listings.findByUrl(url)) !== null) {
    return alreadyTracked(repository, url);
  }
  const fetched = await stores.fetchListing(pluginId, url);
  if (!fetched.ok) {
    return err({ kind: AddErrorKind.FetchFailed, error: fetched.error });
  }
  return ok({ url, pluginId, fetched: fetched.value });
};

/** An active listing of `target` with no failures and its first snapshot, quoted for the saved ship-to country. */
export const newListing = async (
  deps: AddDeps,
  productId: ProductId,
  target: Target,
  origin: ListingOrigin,
  now: Date,
): Promise<AddedListing> => {
  const { shipToCountry } = await deps.repository.settings.get();
  const listing: Listing = {
    id: listingIdSchema.parse(deps.ids.next()),
    productId,
    pluginId: target.pluginId,
    url: target.url,
    title: target.fetched.title,
    status: ListingStatus.Active,
    origin,
    addedAt: now,
    failureStreak: 0,
    notFoundStreak: 0,
  };
  const { itemPrice, shipping, inStock } = target.fetched;
  const snapshot: PriceSnapshot = {
    id: snapshotIdSchema.parse(deps.ids.next()),
    listingId: listing.id,
    observedAt: now,
    shipTo: shipToCountry,
    itemPrice,
    shipping,
    inStock,
  };
  return { listing, snapshot };
};

/**
 * Starts watching the product behind a pasted store URL: stores a product named after the listing title, its first
 * listing and its first snapshot, all or nothing.
 *
 * @remarks
 * The URL is normalized with {@link normalizeListingUrl} first. A URL a listing already tracks is never fetched and
 * stores nothing: it yields `already_tracked` with that listing, also when another add stores the URL while this one
 * is fetching. An `ok` result therefore always means a new product, for which assisted matching can start.
 *
 * @param deps - The ports to use.
 * @param url - The URL as the user pasted it.
 * @returns What was stored, or why nothing was.
 */
export const addProduct = async (deps: AddDeps, url: string): Promise<Result<AddedProduct, AddProductError>> => {
  const target = await fetchNew(deps, url);
  if (!target.ok) {
    return target;
  }
  const now = deps.clock.now();
  const product: Product = {
    id: productIdSchema.parse(deps.ids.next()),
    name: target.value.fetched.title,
    createdAt: now,
    archivedAt: null,
  };
  const { listing, snapshot } = await newListing(deps, product.id, target.value, ListingOrigin.Manual, now);
  const stored = await deps.repository.products.add(product, listing, snapshot);
  return stored.ok ? ok({ product, listing, snapshot }) : alreadyTracked(deps.repository, listing.url);
};

/**
 * Adds a pasted store URL to an existing product as a `manual` listing with its first snapshot, both or neither.
 *
 * @remarks
 * Normalizes, resolves the plugin, dedupes and fetches exactly like {@link addProduct}. The product is checked when
 * the listing is stored, after the fetch, so an unknown product yields `not_found` and stores nothing.
 *
 * @param deps - The ports to use.
 * @param productId - The product the listing belongs to.
 * @param url - The URL as the user pasted it.
 * @returns What was stored, or why nothing was.
 */
export const addListing = async (
  deps: AddDeps,
  productId: ProductId,
  url: string,
): Promise<Result<AddedListing, AddListingError>> => {
  const target = await fetchNew(deps, url);
  if (!target.ok) {
    return target;
  }
  const added = await newListing(deps, productId, target.value, ListingOrigin.Manual, deps.clock.now());
  const stored = await deps.repository.listings.addWithSnapshot(added.listing, added.snapshot);
  if (stored.ok) {
    return ok(added);
  }
  if (stored.error.kind === RepositoryErrorKind.NotFound) {
    return err(stored.error);
  }
  return alreadyTracked(deps.repository, added.listing.url);
};
