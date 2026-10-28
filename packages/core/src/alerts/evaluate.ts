import type { Listing, PriceSnapshot } from "../entities.js";
import type { ListingId, ProductId } from "../ids.js";
import type { FxTable } from "../pricing/fx.js";
import { backInStock } from "./back-in-stock.js";
import type { AlertDraft, AlertSettings, ListingWithLatest } from "./draft.js";
import { keptCheapest, newCheapest } from "./new-cheapest.js";
import { priceDrop } from "./price-drop.js";

/**
 * Everything one evaluation reads. `history` is the listing's earlier snapshots, `incoming` the one just observed.
 * `productListings` holds the product's listings with their newest snapshots; the listing's own entry is replaced by
 * the incoming snapshot, or added if absent. History entries that are the incoming snapshot or not older than it are
 * ignored. `rates` is null when no exchange rates were ever fetched; see {@link evaluateCheapest}.
 */
export interface EvaluateInput {
  listing: Listing;
  history: readonly PriceSnapshot[];
  incoming: PriceSnapshot;
  productListings: readonly ListingWithLatest[];
  previousCheapestListingId: ListingId | null;
  rates: FxTable | null;
  settings: AlertSettings;
  now: Date;
}

/** What one evaluation decided: the alerts to raise, and the product's cheapest listing for the next evaluation. */
export interface Evaluation {
  alerts: AlertDraft[];
  cheapestListingId: ListingId | null;
}

/** What {@link evaluateCheapest} reads: the product, and the rest as {@link EvaluateInput} describes it. */
export type CheapestInput = Pick<
  EvaluateInput,
  "productListings" | "previousCheapestListingId" | "rates" | "settings" | "now"
> & { productId: ProductId };

/**
 * Recomputes only the product's cheapest listing, raising at most a new cheapest alert. With `rates` null listings
 * are not compared across stores: no alert is raised and the previous cheapest is kept, unless it is gone.
 */
export const evaluateCheapest = (input: CheapestInput): Evaluation => {
  const { productId, productListings, previousCheapestListingId, rates, settings, now } = input;
  if (rates === null) {
    return { alerts: [], cheapestListingId: keptCheapest(productListings, previousCheapestListingId) };
  }
  const cheapest = newCheapest(productId, productListings, previousCheapestListingId, rates, settings, now);
  return { alerts: cheapest.alert === null ? [] : [cheapest.alert], cheapestListingId: cheapest.cheapestListingId };
};

/**
 * Decides which alerts a new snapshot raises: price drop, back in stock and new cheapest, in that order. Pure: it
 * reads only its input, and the caller assigns alert ids and persists `cheapestListingId`.
 */
export const evaluate = (input: EvaluateInput): Evaluation => {
  const { listing, incoming, now } = input;
  const history = input.history.filter(
    (snapshot) => snapshot.id !== incoming.id && snapshot.observedAt < incoming.observedAt,
  );
  const productListings = [
    ...input.productListings.filter((entry) => entry.listing.id !== listing.id),
    { listing, latest: incoming },
  ];
  const cheapest = evaluateCheapest({ ...input, productId: listing.productId, productListings });
  const drafts = [
    priceDrop(listing, history, incoming, input.settings.priceDropMinBasisPoints, now),
    backInStock(listing, history, incoming, now),
  ];
  return {
    alerts: [...drafts.filter((draft) => draft !== null), ...cheapest.alerts],
    cheapestListingId: cheapest.cheapestListingId,
  };
};
