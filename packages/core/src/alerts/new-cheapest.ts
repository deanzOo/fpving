import { ShippingKind } from "@fpving/plugin-sdk";
import { AlertKind, ListingStatus } from "../entities.js";
import type { FxTable } from "../pricing/fx.js";
import { landedCostExact } from "../pricing/landed-cost.js";
import type { ListingId, ProductId } from "../ids.js";
import type { AlertDraft, AlertSettings, ListingWithLatest } from "./draft.js";

/** A listing with its newest snapshot and its landed cost in minor units of the display currency. */
export interface Ranked {
  entry: ListingWithLatest;
  landedMinor: number;
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : 1);

const compare = (a: Ranked, b: Ranked): number =>
  a.landedMinor - b.landedMinor
  || a.entry.listing.addedAt.getTime() - b.entry.listing.addedAt.getTime()
  || compareIds(a.entry.listing.id, b.entry.listing.id);

/**
 * The cheapest of a product's listings that are active, in stock, quoted for `shipToCountry` and with known shipping,
 * by `cost`, which yields null for a listing it cannot price. Ties go to the earlier `addedAt`, then the lower
 * listing id by code point. Undefined when none qualifies.
 */
export const cheapestBy = (
  productListings: readonly ListingWithLatest[],
  shipToCountry: AlertSettings["shipToCountry"],
  cost: (latest: ListingWithLatest["latest"]) => number | null,
): Ranked | undefined =>
  productListings
    .filter(
      ({ listing: l, latest }) =>
        l.status === ListingStatus.Active
        && latest.shipTo === shipToCountry
        && latest.inStock
        && latest.shipping.kind === ShippingKind.Known,
    )
    .flatMap((entry): Ranked[] => {
      const landedMinor = cost(entry.latest);
      return landedMinor === null ? [] : [{ entry, landedMinor }];
    })
    .sort(compare)[0];

/** The cheapest listing by landed cost, and the alert if it is not the one that was cheapest before. */
export interface CheapestResult {
  cheapestListingId: ListingId | null;
  alert: AlertDraft | null;
}

const DROPPED: readonly ListingStatus[] = [ListingStatus.Gone, ListingStatus.Removed];

/**
 * The cheapest listing to keep when none qualifies: the previous one, or null when that listing is gone or removed.
 * A previous cheapest that is stale or out of stock is kept.
 */
export const keptCheapest = (
  productListings: readonly ListingWithLatest[],
  previousCheapestListingId: ListingId | null,
): ListingId | null =>
  productListings.some(
    ({ listing }) => listing.id === previousCheapestListingId && DROPPED.includes(listing.status),
  )
    ? null
    : previousCheapestListingId;

/**
 * Finds the product's cheapest listing among those that are active, in stock, quoted for `settings.shipToCountry`,
 * with known shipping and a landed cost computable in the display currency; the others are left out. A latest
 * snapshot quoted for another destination, as after a destination switch, is never compared. Ties go to the lower
 * landed cost, then the earlier `addedAt`, then the lower listing id. Raises a new cheapest alert on that listing
 * when `previousCheapestListingId` is set and differs, and never on the first scan, when it is null. When no
 * listing qualifies the previous id is returned as {@link keptCheapest} keeps it, without an alert.
 * Ids compare by code point.
 */
export const newCheapest = (
  productId: ProductId,
  productListings: readonly ListingWithLatest[],
  previousCheapestListingId: ListingId | null,
  rates: FxTable,
  settings: AlertSettings,
  now: Date,
): CheapestResult => {
  const cheapest = cheapestBy(productListings, settings.shipToCountry, (latest) => {
    const cost = landedCostExact(latest, settings, rates);
    return cost.ok ? cost.value : null;
  });
  if (cheapest === undefined) {
    return { cheapestListingId: keptCheapest(productListings, previousCheapestListingId), alert: null };
  }
  const cheapestListingId = cheapest.entry.listing.id;
  if (previousCheapestListingId === null || previousCheapestListingId === cheapestListingId) {
    return { cheapestListingId, alert: null };
  }
  return {
    cheapestListingId,
    alert: {
      kind: AlertKind.NewCheapest,
      productId,
      listingId: cheapestListingId,
      beforeSnapshotId: null,
      afterSnapshotId: cheapest.entry.latest.id,
      createdAt: now,
    },
  };
};
