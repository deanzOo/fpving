import { err, ok } from "@fpving/plugin-sdk";
import type { Money, Result } from "@fpving/plugin-sdk";
import type { ListingWithLatest } from "../alerts/draft.js";
import type { Listing, PriceSnapshot, Product } from "../entities.js";
import type { ListingId, ProductId } from "../ids.js";

const EPOCH = new Date(0);
import { cheapestBy } from "../alerts/new-cheapest.js";
import { landedCost } from "../pricing/landed-cost.js";
import { liveProduct } from "./add.js";
import type { CoreDeps, ProductNotFound } from "./add.js";
import { AddErrorKind } from "./errors.js";

/** A product's cheapest listing and its landed cost in the display currency. */
export interface CheapestPrice {
  readonly listingId: ListingId;
  readonly landedCost: Money;
}

/** One watched product and its cheapest landed price, or null when no listing can be priced. */
export interface WatchlistEntry {
  readonly product: Product;
  readonly cheapest: CheapestPrice | null;
}

/** A listing with every snapshot of it, oldest first. */
export interface ListingHistory {
  readonly listing: Listing;
  readonly history: PriceSnapshot[];
}

/** A product with its listings and their price histories. */
export interface ProductDetail {
  readonly product: Product;
  readonly listings: ListingHistory[];
}

/**
 * The watched products, newest first, each with its cheapest landed price: the {@link landedCost} in the display
 * currency of the latest snapshot of each listing, over the latest stored exchange rates, among the listings a new
 * cheapest alert compares (active, in stock, quoted for the saved ship-to country, with known shipping). A listing
 * whose cost cannot be computed is left out; without stored rates no product has a cheapest price.
 *
 * @param deps - The repository.
 * @returns One entry per product that is not archived.
 */
export const watchlist = async ({ repository }: Pick<CoreDeps, "repository">): Promise<WatchlistEntry[]> => {
  const settings = await repository.settings.get();
  const rates = await repository.fxRates.latest();
  // ponytail: three reads per product; fine for a personal watchlist, add a joined query if it grows to thousands.
  return Promise.all((await repository.products.list()).map(async (product): Promise<WatchlistEntry> => {
    if (rates === null) {
      return { product, cheapest: null };
    }
    const listings = await repository.listings.listByProduct(product.id);
    const latest = await repository.snapshots.latestPerListing(product.id);
    const entries = listings.flatMap((listing): ListingWithLatest[] =>
      latest.filter((row) => row.listingId === listing.id).map((row) => ({ listing, latest: row })));
    const cheapest = cheapestBy(entries, settings.shipToCountry, (row) => {
      const cost = landedCost(row, settings, rates);
      return cost.ok ? cost.value.amountMinor : null;
    });
    return {
      product,
      cheapest: cheapest === undefined
        ? null
        : {
            listingId: cheapest.entry.listing.id,
            landedCost: { amountMinor: cheapest.landedMinor, currency: settings.displayCurrency },
          },
    };
  }));
};

/**
 * A product with its listings, oldest first, and each listing's snapshots, oldest first.
 *
 * @param deps - The repository.
 * @param productId - The product.
 * @returns The detail, or `product_not_found` for a product that is missing or archived.
 */
export const productDetail = async (
  { repository }: Pick<CoreDeps, "repository">,
  productId: ProductId,
): Promise<Result<ProductDetail, ProductNotFound>> => {
  const product = await liveProduct(repository, productId);
  if (product === null) {
    return err({ kind: AddErrorKind.ProductNotFound });
  }
  const listings = await Promise.all((await repository.listings.listByProduct(productId)).map(async (listing) => ({
    listing,
    history: await repository.snapshots.listSince(listing.id, EPOCH),
  })));
  return ok({ product, listings });
};
