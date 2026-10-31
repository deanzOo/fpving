import { err, ok } from "@fpving/plugin-sdk";
import type { Money, Result } from "@fpving/plugin-sdk";
import type { ListingWithLatest } from "../alerts/draft.js";
import { ListingStatus } from "../entities.js";
import type { Listing, PriceSnapshot, Product, Settings } from "../entities.js";
import type { ListingId, ProductId } from "../ids.js";
import { cheapestBy } from "../alerts/new-cheapest.js";
import type { Ranked } from "../alerts/new-cheapest.js";
import type { FxTable } from "../pricing/fx.js";
import { landedCostExact } from "../pricing/landed-cost.js";
import { roundMinor } from "../pricing/money.js";
import { liveProduct } from "./add.js";
import type { CoreDeps, ProductNotFound } from "./add.js";
import { AddErrorKind } from "./errors.js";

const EPOCH = new Date(0);
const MS_PER_DAY = 86_400_000;

const displayPricer = (settings: Settings, rates: FxTable | null) => ({
  exact: (snapshot: PriceSnapshot): number | null => {
    if (rates === null || snapshot.shipTo !== settings.shipToCountry) {
      return null;
    }
    const cost = landedCostExact(snapshot, settings, rates);
    return cost.ok ? cost.value : null;
  },
  shown: (landedMinor: number): Money => ({ amountMinor: roundMinor(landedMinor), currency: settings.displayCurrency }),
});

/** How many daily points a watchlist trend holds, the last one at now. */
export const TREND_DAYS = 30;

/** A product's cheapest listing and its landed cost in the display currency. */
export interface CheapestPrice {
  readonly listingId: ListingId;
  readonly landedCost: Money;
}

/**
 * One watched product: its cheapest landed price, or null when no listing can be priced, the cheapest landed price
 * once a day over the last {@link TREND_DAYS} days, oldest first, with null on a day none could be priced, and how
 * many of its alerts are unread.
 */
export interface WatchlistEntry {
  readonly product: Product;
  readonly cheapest: CheapestPrice | null;
  readonly trend: (Money | null)[];
  readonly unreadAlerts: number;
}

/**
 * A snapshot with its landed cost in the display currency over the latest stored exchange rates, or null when it
 * cannot be priced: unknown shipping, a missing rate, no rates stored yet, or quoted for a ship-to country other than
 * the saved one.
 */
export type PricedSnapshot = PriceSnapshot & { readonly landedCost: Money | null };

/** A listing with every snapshot of it, oldest first, each with its landed cost. */
export interface ListingHistory {
  readonly listing: Listing;
  readonly history: PricedSnapshot[];
}

/** A product with its listings and their price histories. */
export interface ProductDetail {
  readonly product: Product;
  readonly listings: ListingHistory[];
}

/**
 * The watched products, newest first, each with its cheapest landed price: the landed cost in the display currency
 * of the latest snapshot of each listing, over the latest stored exchange rates, among the listings a new cheapest
 * alert compares (active, in stock, quoted for the saved ship-to country, with known shipping). Listings are ranked
 * on the exact cost, as alerts rank them, and only the cost shown is rounded to a minor unit. A listing
 * whose cost cannot be computed is left out; without stored rates no product has a cheapest price. The trend applies
 * the same rule at now and at each whole day before it, to each listing's latest snapshot observed by then, so its
 * last point is the cheapest price. Each product also counts its unread alerts.
 *
 * @param deps - The repository and the clock the trend ends at.
 * @returns One entry per product that is not archived.
 */
export const watchlist = async (
  { repository, clock }: Pick<CoreDeps, "repository" | "clock">,
): Promise<WatchlistEntry[]> => {
  const now = clock.now().getTime();
  const dayAt = (index: number): Date => new Date(now - (TREND_DAYS - 1 - index) * MS_PER_DAY);
  const days = Array.from({ length: TREND_DAYS }, (_, index) => dayAt(index));
  const [settings, rates, products, listings, snapshots, unread] = await Promise.all([
    repository.settings.get(),
    repository.fxRates.latest(),
    repository.products.list(),
    repository.listings.listToScan(),
    repository.snapshots.listForTrend(dayAt(0)),
    repository.alerts.list({ unreadOnly: true }),
  ]);
  const listingsOf = Map.groupBy(listings, ({ productId }) => productId);
  const snapshotsOf = Map.groupBy(snapshots, ({ listingId }) => listingId);
  const unreadOf = Map.groupBy(unread, ({ productId }) => productId);
  const pricer = displayPricer(settings, rates);
  const shown = ({ landedMinor }: Ranked): Money => pricer.shown(landedMinor);
  return products.map((product): WatchlistEntry => {
    const own = listingsOf.get(product.id) ?? [];
    const ranked = days.map((at) => cheapestBy(own.flatMap((listing): ListingWithLatest[] => {
      const latest = snapshotsOf.get(listing.id)?.findLast(({ observedAt }) => observedAt <= at);
      return latest === undefined ? [] : [{ listing, latest }];
    }), settings.shipToCountry, pricer.exact));
    const cheapest = ranked.at(-1);
    return {
      product,
      cheapest: cheapest === undefined ? null : { listingId: cheapest.entry.listing.id, landedCost: shown(cheapest) },
      trend: ranked.map((day) => (day === undefined ? null : shown(day))),
      unreadAlerts: unreadOf.get(product.id)?.length ?? 0,
    };
  });
};

/**
 * A product with its listings that are not removed, oldest first, and each listing's snapshots, oldest first, each
 * priced as the watchlist prices a listing: the exact landed cost in the display currency over the latest stored
 * exchange rates, rounded to a minor unit, or null when it cannot be priced (see {@link PricedSnapshot}).
 *
 * @param deps - The repository, which holds the settings and the exchange rates.
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
  const kept = (await repository.listings.listByProduct(productId)).filter(
    ({ status }) => status !== ListingStatus.Removed,
  );
  const [settings, rates] = await Promise.all([repository.settings.get(), repository.fxRates.latest()]);
  const pricer = displayPricer(settings, rates);
  const priced = (snapshot: PriceSnapshot): PricedSnapshot => {
    const exact = pricer.exact(snapshot);
    return { ...snapshot, landedCost: exact === null ? null : pricer.shown(exact) };
  };
  const listings = await Promise.all(kept.map(async (listing) => ({
    listing,
    history: (await repository.snapshots.listSince(listing.id, EPOCH)).map(priced),
  })));
  return ok({ product, listings });
};
